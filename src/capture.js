import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { PNG } from "pngjs";
import { resolveLocator } from "./selector.js";
import { CLICK_TIMEOUT_MS } from "./overlays.js";

const CAPTURE_STRATEGIES = new Set(["auto", "playwright", "cdp", "stitched"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function normalizedTimeout(value, fallback = CLICK_TIMEOUT_MS) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 0 ? timeout : fallback;
}

function normalizedStrategy(value) {
  const strategy = String(value || "auto").toLowerCase();
  if (!CAPTURE_STRATEGIES.has(strategy)) {
    throw new Error("strategy must be auto, playwright, cdp, or stitched");
  }
  return strategy;
}

function normalizedAnimations(value) {
  return value === "allow" ? "allow" : "disabled";
}

function errorMessage(error) {
  return error?.message || String(error);
}

function errorCode(error) {
  const message = errorMessage(error);
  if (/deadline|timed out|timeout/i.test(message)) return "CAPTURE_TIMEOUT";
  if (/invalid.*png|image validation/i.test(message)) return "INVALID_CAPTURE_IMAGE";
  if (/unavailable|not supported/i.test(message)) return "CAPTURE_STRATEGY_UNAVAILABLE";
  return "CAPTURE_ATTEMPT_FAILED";
}

function createDeadline(timeoutMs) {
  const requestedTimeoutMs = normalizedTimeout(timeoutMs);
  const startedAt = Date.now();
  const deadlineAt = startedAt + requestedTimeoutMs;

  return {
    startedAt,
    requestedTimeoutMs,
    remaining() {
      return Math.max(0, deadlineAt - Date.now());
    },
    async run(label, operation) {
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      if (remainingMs <= 0) {
        throw new Error(`${label} deadline timed out after ${requestedTimeoutMs}ms`);
      }
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${label} deadline timed out after ${requestedTimeoutMs}ms`)),
              remainingMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function temporaryPath(file) {
  return join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${randomUUID()}`);
}

function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error("Invalid PNG image validation: capture is empty or truncated");
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG image validation: PNG signature mismatch");
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG image validation: IHDR chunk is missing");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error("Invalid PNG image validation: image dimensions are empty");
  }
  return { width, height, bytes: buffer.length, mimeType: "image/png" };
}

function requireCdpContext(page) {
  const context = page.context?.();
  if (!context?.newCDPSession) throw new Error("CDP screenshot fallback is unavailable");
  return context;
}

async function withCdpSession(page, deadline, operation) {
  const context = requireCdpContext(page);
  const session = await deadline.run("CDP session creation", () => context.newCDPSession(page));
  try {
    return await operation(session);
  } finally {
    if (deadline.remaining() > 0) {
      await deadline.run("CDP session detach", () => session.detach?.()).catch(() => {});
    } else {
      Promise.resolve(session.detach?.()).catch(() => {});
    }
  }
}

async function readStagedPlaywrightResult(result, temp, deadline) {
  if (Buffer.isBuffer(result)) {
    const staged = await fs.stat(temp).then(() => true, () => false);
    return { buffer: result, staged };
  }
  return {
    buffer: await deadline.run("Playwright artifact read", () => fs.readFile(temp)),
    staged: true,
  };
}

async function capturePlaywright(page, temp, { full, clip, timeout, animations }, deadline) {
  const result = await deadline.run("Playwright screenshot", () => page.screenshot({
    path: temp,
    ...(clip ? { clip } : { fullPage: !!full }),
    timeout: Math.min(timeout, Math.max(1, deadline.remaining())),
    animations,
  }));
  return await readStagedPlaywrightResult(result, temp, deadline);
}

async function captureLocatorPlaywright(target, temp, { timeout, animations }, deadline) {
  const result = await deadline.run("Playwright locator screenshot", () => target.screenshot({
    path: temp,
    timeout: Math.min(timeout, Math.max(1, deadline.remaining())),
    animations,
  }));
  return await readStagedPlaywrightResult(result, temp, deadline);
}

async function captureCdpPng(page, params, deadline) {
  return await withCdpSession(page, deadline, async (session) => {
    const result = await deadline.run("CDP screenshot", () => session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      ...params,
    }));
    if (!result?.data) throw new Error("CDP screenshot returned no data");
    return { buffer: Buffer.from(result.data, "base64"), staged: false };
  });
}

async function captureSelectorWithCdp(page, clip, deadline) {
  const scroll = await deadline.run("selector scroll read", () => page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  })));
  return await captureCdpPng(page, {
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, clip.x + Number(scroll?.x || 0)),
      y: Math.max(0, clip.y + Number(scroll?.y || 0)),
      width: clip.width,
      height: clip.height,
      scale: 1,
    },
  }, deadline);
}

async function captureViewportWithCdp(page, deadline) {
  return await captureCdpPng(page, { captureBeyondViewport: false }, deadline);
}

async function readFullPageMetrics(page, deadline) {
  return await withCdpSession(page, deadline, async (session) => {
    const metrics = await deadline.run("CDP layout metrics", () => session.send("Page.getLayoutMetrics"));
    const contentSize = metrics?.cssContentSize || metrics?.contentSize;
    if (!contentSize || contentSize.width <= 0 || contentSize.height <= 0) {
      throw new Error("CDP layout metrics returned invalid content size");
    }
    return {
      x: Math.max(0, Number(contentSize.x) || 0),
      y: Math.max(0, Number(contentSize.y) || 0),
      width: Math.ceil(contentSize.width),
      height: Math.ceil(contentSize.height),
    };
  });
}

async function captureFullPageWithCdp(page, deadline) {
  return await withCdpSession(page, deadline, async (session) => {
    const metrics = await deadline.run("CDP layout metrics", () => session.send("Page.getLayoutMetrics"));
    const contentSize = metrics?.cssContentSize || metrics?.contentSize;
    if (!contentSize || contentSize.width <= 0 || contentSize.height <= 0) {
      throw new Error("CDP layout metrics returned invalid content size");
    }
    const result = await deadline.run("CDP full-page screenshot", () => session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, Number(contentSize.x) || 0),
        y: Math.max(0, Number(contentSize.y) || 0),
        width: contentSize.width,
        height: contentSize.height,
        scale: 1,
      },
    }));
    if (!result?.data) throw new Error("CDP screenshot returned no data");
    return { buffer: Buffer.from(result.data, "base64"), staged: false };
  });
}

async function captureFullPageStitched(page, deadline, { timeout, animations }) {
  const content = await readFullPageMetrics(page, deadline);
  const viewport = page.viewportSize?.();
  const viewportWidth = Math.max(1, Math.floor(Number(viewport?.width) || content.width));
  const viewportHeight = Math.max(1, Math.floor(Number(viewport?.height) || Math.min(content.height, 900)));
  const output = new PNG({ width: content.width, height: content.height });

  for (let y = 0; y < content.height; y += viewportHeight) {
    const segmentHeight = Math.min(viewportHeight, content.height - y);
    const result = await deadline.run("Playwright stitched segment", () => page.screenshot({
      clip: {
        x: content.x,
        y: content.y + y,
        width: Math.min(viewportWidth, content.width),
        height: segmentHeight,
      },
      timeout: Math.min(timeout, Math.max(1, deadline.remaining())),
      animations,
    }));
    if (!Buffer.isBuffer(result)) {
      throw new Error("Playwright stitched segment returned no image buffer");
    }
    const segment = PNG.sync.read(result);
    const copyWidth = Math.min(segment.width, output.width);
    const copyHeight = Math.min(segment.height, segmentHeight);
    PNG.bitblt(segment, output, 0, 0, copyWidth, copyHeight, 0, y);
  }

  return { buffer: PNG.sync.write(output), staged: false };
}

async function publishCapture({ buffer, staged }, file, temp, deadline) {
  const image = inspectPng(buffer);
  if (!staged) {
    await deadline.run("capture artifact write", () => fs.writeFile(temp, buffer));
  }
  await deadline.run("capture artifact publish", () => fs.rename(temp, file));
  return image;
}

async function runAttempt(attempts, strategy, operation) {
  const startedAt = Date.now();
  try {
    const result = await operation();
    attempts.push({ strategy, status: "success", durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    attempts.push({
      strategy,
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: errorCode(error),
      error: errorMessage(error),
    });
    throw error;
  }
}

function captureFailure(attempts) {
  const failures = attempts.filter((attempt) => attempt.status === "failed");
  const message = failures
    .map((attempt) => `${attempt.strategy}: ${attempt.error}`)
    .join("; ") || "capture failed without a completed attempt";
  const error = new Error(`Capture failed: ${message}`);
  error.code = "CAPTURE_FAILED";
  error.attempts = attempts;
  return error;
}

function captureOrder(strategy, preferredStrategy, full) {
  if (strategy === "playwright") return ["playwright"];
  if (strategy === "cdp") return ["cdp"];
  if (strategy === "stitched") return ["stitched"];
  if (preferredStrategy === "cdp") {
    return full ? ["cdp", "playwright", "stitched"] : ["cdp", "playwright"];
  }
  return full ? ["playwright", "cdp", "stitched"] : ["playwright", "cdp"];
}

export async function captureScreenshot(page, {
  out,
  outputDir = process.cwd(),
  sessionId,
  full = false,
  selector,
  timeoutMs,
  strategy,
  preferredStrategy,
  animations,
} = {}) {
  const deadline = createDeadline(timeoutMs);
  const timeout = deadline.requestedTimeoutMs;
  const requestedStrategy = normalizedStrategy(strategy);
  const animationPolicy = normalizedAnimations(animations);
  const file = out || join(outputDir, `pursr-${sessionId}-${Date.now()}.png`);
  const temp = temporaryPath(file);
  const attempts = [];
  await fs.mkdir(dirname(file), { recursive: true });

  let captureMode = full ? "full-page" : "viewport";
  let fallbackError = null;

  try {
    let captured;

    if (selector) {
      const locator = await deadline.run("selector resolution", () => resolveLocator(page, selector));
      const target = locator.first();
      const selectorStrategies = requestedStrategy === "cdp"
        ? ["cdp"]
        : requestedStrategy === "playwright"
          ? ["playwright"]
          : ["playwright", "cdp", "playwright-clip"];
      let clip = null;

      for (const current of selectorStrategies) {
        await fs.rm(temp, { force: true }).catch(() => {});
        try {
          if (current === "playwright") {
            captured = await runAttempt(attempts, "playwright", () => captureLocatorPlaywright(
              target,
              temp,
              { timeout, animations: animationPolicy },
              deadline,
            ));
            captureMode = "locator";
          } else {
            if (!clip) {
              await deadline.run("selector visibility wait", () => target.waitFor({
                state: "visible",
                timeout: Math.min(timeout, Math.max(1, deadline.remaining())),
              }));
              clip = await deadline.run("selector bounding box", () => target.boundingBox());
              if (!clip || clip.width <= 0 || clip.height <= 0) {
                throw new Error("selector capture returned an empty bounding box");
              }
            }
            if (current === "cdp") {
              captured = await runAttempt(attempts, "cdp", () => captureSelectorWithCdp(page, clip, deadline));
              captureMode = "cdp-clip-fallback";
            } else {
              captured = await runAttempt(attempts, "playwright-clip", () => capturePlaywright(
                page,
                temp,
                { clip, timeout, animations: animationPolicy },
                deadline,
              ));
              captureMode = "clip-fallback";
            }
          }
          break;
        } catch (error) {
          fallbackError ||= errorMessage(error);
        }
      }
    } else {
      for (const current of captureOrder(requestedStrategy, preferredStrategy, !!full)) {
        await fs.rm(temp, { force: true }).catch(() => {});
        try {
          if (current === "playwright") {
            captured = await runAttempt(attempts, "playwright", () => capturePlaywright(
              page,
              temp,
              { full, timeout, animations: animationPolicy },
              deadline,
            ));
            captureMode = full ? "full-page" : "viewport";
          } else if (current === "cdp") {
            captured = await runAttempt(attempts, "cdp", () => full
              ? captureFullPageWithCdp(page, deadline)
              : captureViewportWithCdp(page, deadline));
            captureMode = full
              ? (attempts.length > 1 ? "cdp-full-page-fallback" : "cdp-full-page")
              : (attempts.length > 1 ? "cdp-viewport-fallback" : "cdp-viewport");
          } else {
            if (!full) throw new Error("stitched capture requires full=true");
            captured = await runAttempt(attempts, "stitched", () => captureFullPageStitched(
              page,
              deadline,
              { timeout, animations: animationPolicy },
            ));
            captureMode = attempts.length > 1
              ? "stitched-full-page-fallback"
              : "stitched-full-page";
          }
          break;
        } catch (error) {
          fallbackError ||= errorMessage(error);
        }
      }
    }

    if (!captured) throw captureFailure(attempts);
    let image;
    try {
      image = await publishCapture(captured, file, temp, deadline);
    } catch (error) {
      const success = [...attempts].reverse().find((attempt) => attempt.status === "success");
      if (success) {
        success.status = "failed";
        success.errorCode = errorCode(error);
        success.error = errorMessage(error);
      }
      throw captureFailure(attempts);
    }
    const elapsedMs = Date.now() - deadline.startedAt;

    return {
      sessionId,
      out: file,
      url: page.url?.() || null,
      data: captured.buffer.toString("base64"),
      mimeType: "image/png",
      captureMode,
      fallbackUsed: attempts.length > 1,
      elapsedMs,
      requestedTimeoutMs: timeout,
      attempts,
      image,
      ...(fallbackError ? { fallbackError } : {}),
    };
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    if (error?.code === "CAPTURE_FAILED") throw error;
    if (attempts.length) throw captureFailure(attempts);
    throw error;
  }
}

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { PNG } from "pngjs";
import { resolveLocator } from "./selector.js";
import { CLICK_TIMEOUT_MS } from "./overlays.js";

const CAPTURE_STRATEGIES = new Set(["auto", "playwright", "cdp", "stitched"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BASE64_CHUNK_BYTES = 768 * 1024;
const COPY_YIELD_ROWS = 64;

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
  if (/invalid.*png|image validation|crc|unexpected end/i.test(message)) return "INVALID_CAPTURE_IMAGE";
  if (/unavailable|not supported|requires/i.test(message)) return "CAPTURE_STRATEGY_UNAVAILABLE";
  return "CAPTURE_ATTEMPT_FAILED";
}

function createDeadline(timeoutMs) {
  const requestedTimeoutMs = normalizedTimeout(timeoutMs);
  const startedAt = Date.now();
  const deadlineAt = startedAt + requestedTimeoutMs;
  const timeoutError = (label) => new Error(`${label} deadline timed out after ${requestedTimeoutMs}ms`);
  const assertRemaining = (label) => {
    if (Date.now() >= deadlineAt) throw timeoutError(label);
  };

  return {
    startedAt,
    requestedTimeoutMs,
    remaining() {
      return Math.max(0, deadlineAt - Date.now());
    },
    assert: assertRemaining,
    async run(label, operation) {
      assertRemaining(label);
      const remainingMs = Math.max(1, deadlineAt - Date.now());
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(timeoutError(label)), remainingMs);
            timer.unref?.();
          }),
        ]);
        assertRemaining(label);
        return result;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function temporaryPath(file) {
  return join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${randomUUID()}`);
}

function backupPath(file) {
  return join(dirname(file), `.${basename(file)}.backup-${process.pid}-${randomUUID()}`);
}

async function removeTemporary(temp, deadline, { bestEffort = false } = {}) {
  const remove = () => fs.rm(temp, { force: true });
  if (bestEffort && deadline.remaining() <= 0) {
    Promise.resolve(remove()).catch(() => {});
    return;
  }
  await deadline.run("capture temporary cleanup", remove).catch((error) => {
    if (!bestEffort) throw error;
  });
}

async function decodePng(buffer, deadline, label = "PNG image validation") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error("Invalid PNG image validation: capture is empty or truncated");
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG image validation: PNG signature mismatch");
  }

  return await deadline.run(label, () => new Promise((resolve, reject) => {
    const png = new PNG({ checkCRC: true });
    png.parse(buffer, (error, decoded) => {
      if (error) {
        reject(new Error(`Invalid PNG image validation: ${error.message}`));
        return;
      }
      if (!decoded || decoded.width <= 0 || decoded.height <= 0) {
        reject(new Error("Invalid PNG image validation: image dimensions are empty"));
        return;
      }
      resolve(decoded);
    });
  }));
}

async function inspectPng(buffer, deadline) {
  const decoded = await decodePng(buffer, deadline);
  return {
    width: decoded.width,
    height: decoded.height,
    bytes: buffer.length,
    mimeType: "image/png",
  };
}

async function encodePng(png, deadline, label = "PNG image encoding") {
  return await deadline.run(label, () => new Promise((resolve, reject) => {
    const chunks = [];
    const stream = png.pack();
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  }));
}

async function encodeBase64(buffer, deadline) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += BASE64_CHUNK_BYTES) {
    deadline.assert("capture response encoding");
    const end = Math.min(buffer.length, offset + BASE64_CHUNK_BYTES);
    chunks.push(buffer.subarray(offset, end).toString("base64"));
    if (end < buffer.length) {
      await deadline.run("capture response encoding", () => new Promise((resolve) => setImmediate(resolve)));
    }
  }
  deadline.assert("capture response encoding");
  const encoded = chunks.join("");
  deadline.assert("capture response encoding");
  return encoded;
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
    const staged = await deadline.run(
      "Playwright artifact inspection",
      () => fs.stat(temp).then(() => true, () => false),
    );
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

function parseContentSize(metrics) {
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
}

async function readFullPageMetrics(page, deadline) {
  return await withCdpSession(page, deadline, async (session) => {
    const metrics = await deadline.run("CDP layout metrics", () => session.send("Page.getLayoutMetrics"));
    return parseContentSize(metrics);
  });
}

async function captureFullPageWithCdp(page, deadline) {
  return await withCdpSession(page, deadline, async (session) => {
    const metrics = await deadline.run("CDP layout metrics", () => session.send("Page.getLayoutMetrics"));
    const content = parseContentSize(metrics);
    const result = await deadline.run("CDP full-page screenshot", () => session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { ...content, scale: 1 },
    }));
    if (!result?.data) throw new Error("CDP screenshot returned no data");
    return { buffer: Buffer.from(result.data, "base64"), staged: false };
  });
}

async function copyTile(segment, output, destinationX, destinationY, deadline) {
  const rowBytes = segment.width * 4;
  for (let row = 0; row < segment.height; row += 1) {
    deadline.assert("stitched tile copy");
    const sourceStart = row * rowBytes;
    const destinationStart = ((destinationY + row) * output.width + destinationX) * 4;
    segment.data.copy(output.data, destinationStart, sourceStart, sourceStart + rowBytes);
    if ((row + 1) % COPY_YIELD_ROWS === 0) {
      await deadline.run("stitched tile copy", () => new Promise((resolve) => setImmediate(resolve)));
    }
  }
}

async function captureFullPageStitched(page, deadline, { timeout, animations }) {
  const content = await readFullPageMetrics(page, deadline);
  const viewport = page.viewportSize?.();
  const viewportWidth = Math.max(1, Math.floor(Number(viewport?.width) || content.width));
  const viewportHeight = Math.max(1, Math.floor(Number(viewport?.height) || Math.min(content.height, 900)));
  let output = null;
  let scaleX = null;
  let scaleY = null;

  for (let y = 0; y < content.height; y += viewportHeight) {
    const segmentHeight = Math.min(viewportHeight, content.height - y);
    for (let x = 0; x < content.width; x += viewportWidth) {
      const segmentWidth = Math.min(viewportWidth, content.width - x);
      const result = await deadline.run("Playwright stitched segment", () => page.screenshot({
        clip: {
          x: content.x + x,
          y: content.y + y,
          width: segmentWidth,
          height: segmentHeight,
        },
        timeout: Math.min(timeout, Math.max(1, deadline.remaining())),
        animations,
      }));
      if (!Buffer.isBuffer(result)) {
        throw new Error("Playwright stitched segment returned no image buffer");
      }

      const segment = await decodePng(result, deadline, "stitched segment PNG validation");
      if (!output) {
        scaleX = segment.width / segmentWidth;
        scaleY = segment.height / segmentHeight;
        if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
          throw new Error("stitched segment returned invalid device scale");
        }
        deadline.assert("stitched output allocation");
        output = new PNG({
          width: Math.round(content.width * scaleX),
          height: Math.round(content.height * scaleY),
        });
        deadline.assert("stitched output allocation");
      }

      const expectedWidth = Math.round(segmentWidth * scaleX);
      const expectedHeight = Math.round(segmentHeight * scaleY);
      if (segment.width !== expectedWidth || segment.height !== expectedHeight) {
        throw new Error(
          `stitched segment dimensions changed: expected ${expectedWidth}x${expectedHeight}, got ${segment.width}x${segment.height}`,
        );
      }
      await copyTile(
        segment,
        output,
        Math.round(x * scaleX),
        Math.round(y * scaleY),
        deadline,
      );
    }
  }

  if (!output) throw new Error("stitched capture produced no image segments");
  return { buffer: await encodePng(output, deadline, "stitched PNG encoding"), staged: false };
}

async function artifactExists(file, deadline) {
  return await deadline.run("capture artifact inspection", async () => {
    try {
      await fs.stat(file);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  });
}

async function readArtifactIfPresent(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function rollbackCommittedCapture({ commitPromise, file, temp, backup, hadExisting, buffer }) {
  await Promise.resolve(commitPromise).catch(() => {});
  try {
    const current = await readArtifactIfPresent(file);
    const ownsCurrent = Buffer.isBuffer(current) && current.equals(buffer);
    if (ownsCurrent || (!current && hadExisting)) {
      if (hadExisting) await fs.copyFile(backup, file);
      else await fs.rm(file, { force: true });
    }
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
    await fs.rm(backup, { force: true }).catch(() => {});
  }
}

function scheduleCaptureRollback(options) {
  Promise.resolve()
    .then(() => rollbackCommittedCapture(options))
    .catch(() => {});
}

async function publishCapture({ buffer, staged }, file, temp, deadline) {
  const backup = backupPath(file);
  let hadExisting = false;
  let commitPromise = null;
  try {
    if (!staged) {
      await deadline.run("capture artifact write", () => fs.writeFile(temp, buffer));
    }
    hadExisting = await artifactExists(file, deadline);
    if (hadExisting) {
      await deadline.run("capture artifact backup", () => fs.copyFile(file, backup));
    }
    commitPromise = Promise.resolve().then(() => fs.rename(temp, file));
    await deadline.run("capture artifact publish", () => commitPromise);
  } catch (error) {
    if (commitPromise) {
      scheduleCaptureRollback({ commitPromise, file, temp, backup, hadExisting, buffer });
    } else {
      Promise.resolve(fs.rm(backup, { force: true })).catch(() => {});
    }
    throw error;
  }
  Promise.resolve(fs.rm(backup, { force: true })).catch(() => {});
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

function selectorCaptureOrder(strategy, preferredStrategy) {
  if (strategy === "stitched") {
    throw new Error("stitched strategy is not available for selector capture");
  }
  if (strategy === "playwright") return ["playwright"];
  if (strategy === "cdp") return ["cdp"];
  if (preferredStrategy === "cdp") return ["cdp", "playwright", "playwright-clip"];
  return ["playwright", "cdp", "playwright-clip"];
}

async function resolveSelectorClip(target, deadline, timeout) {
  await deadline.run("selector visibility wait", () => target.waitFor({
    state: "visible",
    timeout: Math.min(timeout, Math.max(1, deadline.remaining())),
  }));
  const clip = await deadline.run("selector bounding box", () => target.boundingBox());
  if (!clip || clip.width <= 0 || clip.height <= 0) {
    throw new Error("selector capture returned an empty bounding box");
  }
  return clip;
}

async function captureSelectorFlow({
  page,
  selector,
  requestedStrategy,
  preferredStrategy,
  temp,
  timeout,
  animationPolicy,
  deadline,
  attempts,
}) {
  const locator = await deadline.run("selector resolution", () => resolveLocator(page, selector));
  const target = locator.first();
  let clip = null;
  let fallbackError = null;

  for (const current of selectorCaptureOrder(requestedStrategy, preferredStrategy)) {
    await removeTemporary(temp, deadline);
    try {
      let captured;
      let captureMode;
      if (current === "playwright") {
        captured = await runAttempt(attempts, "playwright", () => captureLocatorPlaywright(
          target,
          temp,
          { timeout, animations: animationPolicy },
          deadline,
        ));
        captureMode = "locator";
      } else {
        if (current === "cdp") {
          captured = await runAttempt(attempts, "cdp", async () => {
            clip ||= await resolveSelectorClip(target, deadline, timeout);
            return await captureSelectorWithCdp(page, clip, deadline);
          });
          captureMode = attempts.length > 1 ? "cdp-clip-fallback" : "cdp-clip";
        } else {
          captured = await runAttempt(attempts, "playwright-clip", async () => {
            clip ||= await resolveSelectorClip(target, deadline, timeout);
            return await capturePlaywright(
              page,
              temp,
              { clip, timeout, animations: animationPolicy },
              deadline,
            );
          });
          captureMode = "clip-fallback";
        }
      }
      return { captured, captureMode, fallbackError };
    } catch (error) {
      fallbackError ||= errorMessage(error);
    }
  }

  return { captured: null, captureMode: "locator", fallbackError };
}

async function capturePageFlow({
  page,
  full,
  requestedStrategy,
  preferredStrategy,
  temp,
  timeout,
  animationPolicy,
  deadline,
  attempts,
}) {
  let fallbackError = null;

  for (const current of captureOrder(requestedStrategy, preferredStrategy, full)) {
    await removeTemporary(temp, deadline);
    try {
      let captured;
      let captureMode;
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
      return { captured, captureMode, fallbackError };
    } catch (error) {
      fallbackError ||= errorMessage(error);
    }
  }

  return { captured: null, captureMode: full ? "full-page" : "viewport", fallbackError };
}

function safePageUrl(page) {
  try {
    return page.url?.() || null;
  } catch {
    return null;
  }
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
  if (selector && requestedStrategy === "stitched") {
    throw new Error("stitched strategy is not available for selector capture");
  }
  if (requestedStrategy === "stitched" && !full) {
    throw new Error("stitched strategy requires full=true");
  }

  const file = out || join(outputDir, `pursr-${sessionId}-${Date.now()}.png`);
  const temp = temporaryPath(file);
  const attempts = [];

  try {
    await deadline.run("capture artifact directory preparation", () => fs.mkdir(dirname(file), { recursive: true }));
    const flow = selector
      ? await captureSelectorFlow({
        page,
        selector,
        requestedStrategy,
        preferredStrategy,
        temp,
        timeout,
        animationPolicy,
        deadline,
        attempts,
      })
      : await capturePageFlow({
        page,
        full: !!full,
        requestedStrategy,
        preferredStrategy,
        temp,
        timeout,
        animationPolicy,
        deadline,
        attempts,
      });

    if (!flow.captured) throw captureFailure(attempts);
    let image;
    let data;
    try {
      image = await inspectPng(flow.captured.buffer, deadline);
      data = await encodeBase64(flow.captured.buffer, deadline);
      await publishCapture(flow.captured, file, temp, deadline);
    } catch (error) {
      const success = [...attempts].reverse().find((attempt) => attempt.status === "success");
      if (success) {
        success.status = "failed";
        success.errorCode = errorCode(error);
        success.error = errorMessage(error);
      }
      throw captureFailure(attempts);
    }

    return {
      sessionId,
      out: file,
      url: safePageUrl(page),
      data,
      mimeType: "image/png",
      captureMode: flow.captureMode,
      fallbackUsed: attempts.length > 1,
      elapsedMs: Date.now() - deadline.startedAt,
      requestedTimeoutMs: timeout,
      attempts,
      image,
      ...(flow.fallbackError ? { fallbackError: flow.fallbackError } : {}),
    };
  } catch (error) {
    await removeTemporary(temp, deadline, { bestEffort: true });
    if (error?.code === "CAPTURE_FAILED") throw error;
    if (attempts.length) throw captureFailure(attempts);
    throw error;
  }
}

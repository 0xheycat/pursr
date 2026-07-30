import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveLocator } from "./selector.js";
import { CLICK_TIMEOUT_MS } from "./overlays.js";

function normalizedTimeout(value, fallback = CLICK_TIMEOUT_MS) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 0 ? timeout : fallback;
}

function errorMessage(error) {
  return error?.message || String(error);
}

function combinedCaptureError(primaryError, fallbackError) {
  const error = new Error(
    `Playwright screenshot failed: ${errorMessage(primaryError)}; CDP fallback failed: ${errorMessage(fallbackError)}`,
  );
  error.cause = fallbackError;
  return error;
}

function requireCdpContext(page) {
  const context = page.context?.();
  if (!context?.newCDPSession) throw new Error("CDP screenshot fallback is unavailable");
  return context;
}

async function withCdpSession(page, operation) {
  const session = await requireCdpContext(page).newCDPSession(page);
  try {
    return await operation(session);
  } finally {
    await session.detach?.().catch(() => {});
  }
}

async function captureCdpPng(page, file, params) {
  await withCdpSession(page, async (session) => {
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      ...params,
    });
    if (!result?.data) throw new Error("CDP screenshot returned no data");
    writeFileSync(file, Buffer.from(result.data, "base64"));
  });
}

async function captureSelectorWithCdp(page, clip, file) {
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await captureCdpPng(page, file, {
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, clip.x + Number(scroll?.x || 0)),
      y: Math.max(0, clip.y + Number(scroll?.y || 0)),
      width: clip.width,
      height: clip.height,
      scale: 1,
    },
  });
}

async function captureViewportWithCdp(page, file) {
  await captureCdpPng(page, file, { captureBeyondViewport: false });
}

async function captureFullPageWithCdp(page, file) {
  await withCdpSession(page, async (session) => {
    const metrics = await session.send("Page.getLayoutMetrics");
    const contentSize = metrics?.cssContentSize || metrics?.contentSize;
    if (!contentSize || contentSize.width <= 0 || contentSize.height <= 0) {
      throw new Error("CDP layout metrics returned invalid content size");
    }
    const result = await session.send("Page.captureScreenshot", {
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
    });
    if (!result?.data) throw new Error("CDP screenshot returned no data");
    writeFileSync(file, Buffer.from(result.data, "base64"));
  });
}

export async function captureScreenshot(page, {
  out,
  outputDir = process.cwd(),
  sessionId,
  full = false,
  selector,
  timeoutMs,
} = {}) {
  const timeout = normalizedTimeout(timeoutMs);
  const file = out || join(outputDir, `pursr-${sessionId}-${Date.now()}.png`);
  mkdirSync(dirname(file), { recursive: true });

  let captureMode = full ? "full-page" : "viewport";
  let fallbackError = null;

  if (selector) {
    const locator = await resolveLocator(page, selector);
    const target = locator.first();
    try {
      await target.screenshot({ path: file, timeout, animations: "disabled" });
      captureMode = "locator";
    } catch (error) {
      fallbackError = errorMessage(error);
      await target.waitFor({ state: "visible", timeout });
      const clip = await target.boundingBox();
      if (!clip || clip.width <= 0 || clip.height <= 0) throw error;
      try {
        await captureSelectorWithCdp(page, clip, file);
        captureMode = "cdp-clip-fallback";
      } catch (cdpError) {
        await page.screenshot({ path: file, clip, timeout, animations: "disabled" });
        captureMode = "clip-fallback";
        fallbackError = `${fallbackError}; CDP fallback: ${errorMessage(cdpError)}`;
      }
    }
  } else {
    try {
      await page.screenshot({ path: file, fullPage: !!full, timeout, animations: "disabled" });
    } catch (error) {
      fallbackError = errorMessage(error);
      try {
        if (full) {
          await captureFullPageWithCdp(page, file);
          captureMode = "cdp-full-page-fallback";
        } else {
          await captureViewportWithCdp(page, file);
          captureMode = "cdp-viewport-fallback";
        }
      } catch (cdpError) {
        throw combinedCaptureError(error, cdpError);
      }
    }
  }

  return {
    sessionId,
    out: file,
    url: page.url(),
    data: readFileSync(file).toString("base64"),
    mimeType: "image/png",
    captureMode,
    ...(fallbackError ? { fallbackError } : {}),
  };
}
// Pixelmatch diff against a reference PNG.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { launch, newPage } from "./runway.js";
import { DEFAULT_VIEWPORT } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";
import { requireArg } from "./util.js";
import { aiDiffSidecar } from "./ai-diff.js";

const DIFF_DEFAULT_THRESHOLD = 0.1;

async function loadPngjs() {
  try { return (await import("pngjs")).PNG; }
  catch { throw new Error("pngjs not found. Install: npm i pngjs"); }
}

async function loadPixelmatch() {
  try { return (await import("pixelmatch")).default; }
  catch { throw new Error("pixelmatch not found. Install: npm i pixelmatch"); }
}

export async function runDiff(url, refPath, out, threshold, browser) {
  requireArg("url", url, "string");
  requireArg("refPath", refPath, "string");
  const t = threshold !== undefined ? Number(threshold) : DIFF_DEFAULT_THRESHOLD;
  if (!existsSync(refPath)) return { url, refPath, error: "reference file not found" };
  const PNG = await loadPngjs();
  const pixelmatch = await loadPixelmatch();
  const ownBrowser = !browser;
  browser = browser || await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url); await settle(page);
    const currentPath = out ? out.replace(/\.png$/i, "-current.png") : join(dirname(refPath), "current.png");
    await page.screenshot({ path: currentPath, fullPage: false });
    const refPng = PNG.sync.read(readFileSync(refPath));
    const curPng = PNG.sync.read(readFileSync(currentPath));
    if (refPng.width !== curPng.width || refPng.height !== curPng.height) {
      return { ...r, url, refPath, currentPath, error: "size mismatch", refSize: { w: refPng.width, h: refPng.height }, currentSize: { w: curPng.width, h: curPng.height } };
    }
    const diffPng = new PNG({ width: refPng.width, height: refPng.height });
    const numDiff = pixelmatch(refPng.data, curPng.data, diffPng.data, refPng.width, refPng.height, { threshold: t });
    const totalPx = refPng.width * refPng.height;
    const diffPct = (numDiff / totalPx) * 100;
    if (out) writeFileSync(out, PNG.sync.write(diffPng));
    return { ...r, url, refPath, currentPath, out: out || null, threshold: t, refSize: { w: refPng.width, h: refPng.height }, totalPx, numDiff, diffPct: Number(diffPct.toFixed(3)), equal: numDiff === 0 };
  } finally { if (ownBrowser) try { await browser.close(); } catch {} }
}

/**
 * Like runDiff, but additionally calls a vision LLM to produce a human-readable
 * summary of the visual differences. The AI summary is written to <out>.ai.json
 * and also returned on the result object.
 */
export async function runDiffWithAi(url, refPath, out, threshold, aiOpts, browser) {
  const r = await runDiff(url, refPath, out, threshold, browser);
  if (r.error) return r;
  try {
    const curPath = r.currentPath;
    const sidecar = await aiDiffSidecar({
      refPath, curPath, url,
      model: aiOpts && aiOpts.model,
      baseUrl: aiOpts && aiOpts.baseUrl,
      apiKey: aiOpts && aiOpts.apiKey,
      maxTokens: aiOpts && aiOpts.maxTokens,
    });
    r.ai = sidecar;
    const sidecarPath = (out || curPath).replace(/.png$/i, "") + ".ai.json";
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf8");
    r.aiFile = sidecarPath;
  } catch (e) {
    r.ai = { error: e.message };
  }
  return r;
}

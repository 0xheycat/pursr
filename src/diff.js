// Pixelmatch diff against a reference PNG.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { launch, newPage } from "./runway.js";
import { DEFAULT_VIEWPORT } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";
import { asNum } from "./util.js";

const DIFF_DEFAULT_THRESHOLD = 0.1;

async function loadPngjs() {
  try { return (await import("pngjs")).PNG; }
  catch {
    // Codex cua_node runtime also has pngjs
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    try {
      const url = "file:///" + join(homedir(), "AppData", "Local", "OpenAI", "Codex", "runtimes", "cua_node", "bin", "node_modules", "pngjs", "lib", "png.js").replace(/\\/g, "/");
      return (await import(url)).PNG;
    } catch { throw new Error("pngjs not found. Install: npm i pngjs"); }
  }
}

async function loadPixelmatch() {
  try { return (await import("pixelmatch")).default; }
  catch {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    try {
      const url = "file:///" + join(homedir(), "AppData", "Local", "OpenAI", "Codex", "runtimes", "cua_node", "bin", "node_modules", "pixelmatch", "index.js").replace(/\\/g, "/");
      return (await import(url)).default;
    } catch { throw new Error("pixelmatch not found. Install: npm i pixelmatch"); }
  }
}

export async function runDiff(url, refPath, out, threshold) {
  const t = threshold !== undefined ? Number(threshold) : DIFF_DEFAULT_THRESHOLD;
  if (!existsSync(refPath)) return { url, refPath, error: "reference file not found" };
  const PNG = await loadPngjs();
  const pixelmatch = await loadPixelmatch();
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url); await settle(page);
    const currentPath = out ? out.replace(/\.png$/i, "-current.png") : out.replace(/\.png$/i, "-current.png");
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
    let outPath = null;
    if (out) { writeFileSync(out, PNG.sync.write(diffPng)); outPath = out; }
    return { ...r, url, refPath, currentPath, out: outPath, threshold: t, refSize: { w: refPng.width, h: refPng.height }, totalPx, numDiff, diffPct: Number(diffPct.toFixed(3)), equal: numDiff === 0 };
  } finally { await browser.close(); }
}
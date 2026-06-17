// Frames: capture N screenshots at intervalMs.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";
import { asNum, nowIso } from "./util.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const shortHash = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 10);
import { join } from "node:path";

export async function runFrames({ url, count, intervalMs, outDir, flags = {} }) {
  const n = Math.max(1, Math.min(120, asNum(count, 8)));
  const stepMs = Math.max(16, asNum(intervalMs, 250));
  const dir = outDir;
  mkdirSync(dir, { recursive: true });
  const viewport = resolveViewport(flags);
  const browser = await launch();
  const meta = { url, outDir: dir, count: n, intervalMs: stepMs, viewport, files: [], ts: nowIso() };
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url); await settle(page);
    meta.status = r.status; meta.title = r.title;
    for (let i = 0; i < n; i++) {
      const f = join(dir, `frame-${String(i).padStart(3, "0")}.png`);
      await page.screenshot({ path: f, fullPage: false });
      const buf = readFileSync(f);
      meta.files.push({ i, out: f, size: buf.length, hash: shortHash(buf) });
      if (i + 1 < n) await page.waitForTimeout(stepMs);
    }
    writeFileSync(join(dir, "frames.json"), JSON.stringify(meta, null, 2));
    return meta;
  } finally { await browser.close(); }
}
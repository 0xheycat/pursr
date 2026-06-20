// Every-viewport: capture one screenshot at every registered viewport
// preset in a single command. No JSON plan needed.
//
// Usage:
//   pursor every-viewport https://example.com
//   pursor every-viewport https://example.com --out ./report

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./runway.js";
import { listViewports } from "./viewport.js";
import { runShoot } from "./shoot.js";
import { asNum, nowIso, renderEveryViewportHtml } from "./util.js";

export async function runEveryViewport({ url, outDir, viewports, browser: extBrowser }) {
  const ownBrowser = !extBrowser;
  const browser = extBrowser || await launch();
  const dir = outDir || join(".", `every-viewport-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const all = listViewports();
  const wanted = viewports?.length ? all.filter(v => viewports.includes(v.name)) : all;
  const captures = [];
  try {
    // Bounded concurrency: 3 viewports at a time. Each runShoot reuses the
    // shared browser, so we cap the pool to avoid exhausting Chromium.
    const POOL = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < wanted.length) {
        const idx = cursor++;
        const vp = wanted[idx];
        const out = join(dir, `${vp.name}.png`);
        const t0 = Date.now();
        try {
          const meta = await runShoot({ url, out, flags: { preset: vp.name }, browser });
          captures.push({ name: vp.name, out, ok: true, ms: Date.now() - t0, meta });
        } catch (e) {
          captures.push({ name: vp.name, out, ok: false, ms: Date.now() - t0, error: e.message });
        }
      }
    }
    const workers = Array.from({ length: Math.min(POOL, wanted.length) }, () => worker());
    await Promise.all(workers);
  } finally {
    if (ownBrowser) try { await browser.close(); } catch {}
  }
  const summary = { url, outDir: dir, captures, ts: nowIso(), ok: captures.every(c => c.ok) };
  writeFileSync(join(dir, "every-viewport.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(dir, "index.html"), renderEveryViewportHtml(summary));
  return summary;
}

// pursor — component-level snapshot.
//
// Capture one screenshot per matched element (Percy / Chromatic style).
// Uses Playwright's elementHandle.screenshot() to clip precisely to the
// element's bounding box, even if it scrolls offscreen.
//
// CLI:
//   pursr snap <url> "<selector>" [--out ./snaps/] [--selector "a.btn"]
//   pursr snap <url> "<selector>" --baseline myapp
//
// Library:
//   import { runSnap } from "pursr/snap";
//   const result = await runSnap({ url, selector, outDir: "./snaps" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator, parseTextSelector } from "./selector.js";
import { resolveHealedSelector } from "./selector-heal.js";
import { asNum, nowIso, requireArg } from "./util.js";
import { saveBaseline, diffKey } from "./baseline.js";

/**
 * Capture one screenshot per matched element on a page.
 *
 * @param {object} opts
 * @param {string} opts.url                    Target URL
 * @param {string|string[]} opts.selector      CSS selector, or chain (heal-fallback)
 * @param {string} [opts.outDir=./snaps]      Output directory
 * @param {string} [opts.name]                 Optional name prefix (defaults to selector slug)
 * @param {object} [opts.flags]                Viewport/flags (resolved via resolveViewport)
 * @param {number} [opts.settleMs=400]         Wait after locator resolves
 * @param {number} [opts.max=20]               Max elements to capture (safety)
 * @param {boolean} [opts.scrollIntoView=true] Scroll each into view before capture
 * @param {boolean} [opts.omitBackground=false] Transparent background
 * @returns {Promise<{ url, selector, count, captures: [...], outDir, ts }>}
 */
export async function runSnap(opts) {
  requireArg("url", opts?.url, "string");
  requireArg("selector", opts?.selector, "string");
  const url = opts.url;
  const selector = opts.selector;
  const outDir = opts.outDir || "./snaps";
  const flags = opts.flags || {};
  const viewport = resolveViewport(flags);
  const settleMs = asNum(opts.settleMs, 400);
  const max = Math.max(1, asNum(opts.max, 20));
  const scrollIntoView = opts.scrollIntoView !== false;
  const omitBackground = !!opts.omitBackground;
  const name = opts.name || (Array.isArray(selector) ? selector[0] : selector).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "snap";

  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const captures = [];
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url);
    await settle(page);

    // Resolve to a locator (with auto-heal chain support)
    const locator = Array.isArray(selector)
      ? (await resolveHealedSelector(page, selector)).locator
      : await resolveLocator(page, selector);

    const count = await locator.count();
    if (!count) throw new Error(`snap: selector matched 0 elements`);

    const limit = Math.min(count, max);
    for (let i = 0; i < limit; i++) {
      const handle = locator.nth(i);
      try {
        if (scrollIntoView) await handle.scrollIntoViewIfNeeded({ timeout: CLICK_TIMEOUT_MS }).catch(() => {});
        await page.waitForTimeout(settleMs);
        const file = join(outDir, `${String(i).padStart(2, "0")}-${name}.png`);
        await handle.screenshot({ path: file, omitBackground });
        // Try to get a human label
        let label = null;
        try {
          label = (await handle.evaluate((el) => {
            return el.getAttribute("aria-label")
              || el.getAttribute("title")
              || el.getAttribute("alt")
              || (el.textContent || "").trim().slice(0, 80)
              || el.tagName.toLowerCase();
          }));
        } catch {}
        captures.push({ i, file, label });
      } catch (e) {
        captures.push({ i, error: e.message });
      }
    }

    // Write summary
    const summary = {
      url,
      selector,
      viewport: { width: viewport.width, height: viewport.height, dpr: viewport.dpr },
      count,
      captured: captures.length,
      outDir,
      captures,
      ts: nowIso(),
      nav: { status: r.status, title: r.title },
    };
    writeFileSync(join(outDir, "snap.json"), JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    try { await browser.close(); } catch {}
  }
}

/**
 * Save a snap result as baselines (one per captured element).
 * Useful for "approve all current component screenshots as the new baseline".
 */
export async function approveSnapsAsBaselines({ project, snapResult, id }) {
  if (!snapResult?.captures) throw new Error("approveSnapsAsBaselines: missing snapResult");
  const _id = id || diffKey({ url: snapResult.url, viewport: snapResult.viewport, flags: {} });
  const out = [];
  for (const c of snapResult.captures) {
    if (c.error || !c.file) continue;
    const step = `snap-${String(c.i).padStart(2, "0")}-${(c.label || "elem").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 32)}`;
    const saved = saveBaseline({ project, id: _id, step, png: c.file, meta: { url: snapResult.url, viewport: snapResult.viewport, flags: {} } });
    out.push(saved);
  }
  return out;
}

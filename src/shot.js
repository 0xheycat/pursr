// Simple screenshot (no flags / overlays).

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";
import { requireArg } from "./util.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function runShot(url, out, opts = {}) {
  requireArg("url", url, "string");
  const viewport = resolveViewport(opts);
  const browser = await launch();
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url);
    await settle(page);
    if (out) mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: !!opts.fullPage });
    return { ...r, url, out, viewport, fullPage: !!opts.fullPage };
  } finally { try { await browser.close(); } catch {} }
}

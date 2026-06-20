// Probe: open a viewport, navigate, return basic info. No screenshot.

import { launch, newPage } from "./runway.js";
import { DEFAULT_VIEWPORT } from "./viewport.js";
import { gotoOrThrow } from "./overlays.js";
import { requireArg } from "./util.js";

export async function runProbe(url) {
  requireArg("url", url, "string");
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    let navError = null, status = null, title = null;
    try {
      const r = await gotoOrThrow(page, url);
      status = r.status; title = r.title;
    } catch (e) { navError = e.message; }
    return { url, status, title, navError, viewport: DEFAULT_VIEWPORT };
  } finally { try { await browser.close(); } catch {} }
}
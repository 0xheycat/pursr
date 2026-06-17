// Simple screenshot (no flags / overlays).

import { launch, newPage } from "./runway.js";
import { DEFAULT_VIEWPORT } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";

export async function runShot(url, out, opts = {}) {
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url);
    await settle(page);
    await page.screenshot({ path: out, fullPage: !!opts.fullPage });
    return { ...r, url, out, fullPage: !!opts.fullPage };
  } finally { await browser.close(); }
}
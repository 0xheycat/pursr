// Evaluate a JS string in the page, optionally screenshot after.

import { launch, newPage } from "./runway.js";
import { DEFAULT_VIEWPORT } from "./viewport.js";
import { gotoOrThrow } from "./overlays.js";
import { requireArg } from "./util.js";

export async function runEval(url, js, out) {
  requireArg("url", url, "string");
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url);
    const result = await page.evaluate(js);
    if (out) await page.screenshot({ path: out, fullPage: false });
    return { ...r, url, out, result };
  } finally { try { await browser.close(); } catch {} }
}
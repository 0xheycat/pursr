// Hover capture: navigate, hover a selector, screenshot.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";
import { asNum, asBool, nowIso, writeSidecar, requireArg } from "./util.js";

export async function runHover({ url, selector, out, flags = {} }) {
  requireArg("url", url, "string");
  requireArg("selector", selector, "string");
  const viewport = resolveViewport(flags);
  const browser = await launch();
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url); await settle(page);
    const loc = await resolveLocator(page, selector);
    await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
    await loc.first().hover({ timeout: CLICK_TIMEOUT_MS });
    await page.waitForTimeout(asNum(flags["hover-ms"], 250));
    if (out) await page.screenshot({ path: out, fullPage: asBool(flags.full, false) });
    const meta = { ...r, url, out, selector, viewport, ts: nowIso() };
    if (out) await writeSidecar(meta);
    return meta;
  } finally { try { await browser.close(); } catch {} }
}
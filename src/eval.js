// Evaluate a JS string in the page, optionally screenshot after.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow } from "./overlays.js";
import { requireArg } from "./util.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function runEval(url, js, out, flags = {}) {
  requireArg("url", url, "string");
  const viewport = resolveViewport(flags);
  const browser = await launch();
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url);
    const result = await page.evaluate(js);
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: false });
    }
    return { ...r, url, out, viewport, result };
  } finally { try { await browser.close(); } catch {} }
}

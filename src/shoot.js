// The core capture function: open a viewport, navigate, apply all the
// overlays + camera + frame-stable waits, then screenshot.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import {
  gotoOrThrow, settle, overlayCursor, overlayGrid, hideHud,
  isolateLayer, freezeAnimation, waitForStableFrame, applyCamera,
} from "./overlays.js";
import { asNum, asBool, nowIso, writeSidecar } from "./util.js";
import { runBeforeShoot, runAfterShoot } from "./plugin.js";

export async function runShoot({ url, out, flags = {}, prepare }) {
  const viewport = resolveViewport(flags);
  const browser = await launch();
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url);
    await settle(page);

    // Build a ctx object so plugins can mutate it
    const ctx = { url, out, viewport, flags, browser, page };

    await runBeforeShoot(ctx);

    const cleanups = [];
    cleanups.push(await freezeAnimation(page, asBool(flags["no-animation"], false)));
    cleanups.push(await overlayCursor(page, flags.cursor || "default"));
    if (asBool(flags.grid, false)) cleanups.push(await overlayGrid(page, { tileSize: flags["grid-tile"], color: flags["grid-color"] }));
    if (asBool(flags["no-hud"], false)) cleanups.push(await hideHud(page));
    cleanups.push(await isolateLayer(page, flags.layer || "all"));
    if (typeof prepare === "function") cleanups.push(await prepare(page));

    if (flags["wait-frame"]) await waitForStableFrame(page, asNum(flags["wait-frame"], 600));

    if (flags.zoom || flags.panX || flags.panY) {
      await applyCamera(page, { zoom: asNum(flags.zoom, 1), panX: asNum(flags.panX, 0), panY: asNum(flags.panY, 0) });
      await page.waitForTimeout(400);
    }

    await page.screenshot({ path: out, fullPage: asBool(flags.full, false) });
    const meta = { url, out, ts: nowIso(), status: r.status, title: r.title, viewport, flags: { ...flags } };
    await runAfterShoot(ctx, meta);
    return meta;
  } finally {
    await browser.close();
  }
}

export async function runShootWithSidecar(args) {
  const meta = await runShoot(args);
  await writeSidecar(meta);
  return meta;
}
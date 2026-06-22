// The core capture function: open a viewport, navigate, apply all the
// overlays + camera + frame-stable waits, then screenshot.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import {
  gotoOrThrow, settle, overlayCursor, overlayGrid, hideHud,
  isolateLayer, freezeAnimation, waitForStableFrame, applyCamera,
} from "./overlays.js";
import { asNum, asBool, nowIso, writeSidecar, requireArg } from "./util.js";
import { runBeforeShoot, runAfterShoot } from "./plugin.js";
import { startHarCapture, stopHarCapture, writeHar } from "./har.js";
import { loadAuthState } from "./auth.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function runShoot({ url, out, flags = {}, prepare, browser: extBrowser }) {
  requireArg("url", url, "string");
  if (out) mkdirSync(dirname(out), { recursive: true });
  const viewport = resolveViewport(flags);
  const ownBrowser = !extBrowser;
  const browser = extBrowser || await launch();
  const cleanups = [];
  try {
    return await (async () => {
      const page = await newPage(browser, viewport, {
        storageState: flags["auth-state"] ? loadAuthState({ project: flags["auth-project"] || "default", name: flags["auth-state"] }) : undefined,
      });
      const r = await gotoOrThrow(page, url);
      await settle(page);

      // Build a ctx object so plugins can mutate it
      const ctx = { url, out, viewport, flags, browser, page };

      await runBeforeShoot(ctx);

      cleanups.push(await freezeAnimation(page, asBool(flags["no-animation"], false)));
      cleanups.push(await overlayCursor(page, flags.cursor || "default"));
      if (asBool(flags.grid, false)) cleanups.push(await overlayGrid(page, { tileSize: flags["grid-tile"], color: flags["grid-color"] }));
      if (asBool(flags["no-hud"], false)) cleanups.push(await hideHud(page));
      cleanups.push(await isolateLayer(page, flags.layer || "all"));
      if (typeof prepare === "function") { const c = await prepare(page); if (typeof c === "function") cleanups.push(c); }

      if (flags["wait-frame"]) await waitForStableFrame(page, asNum(flags["wait-frame"], 600));

      if (flags.zoom || flags.panX || flags.panY) {
        await applyCamera(page, { zoom: asNum(flags.zoom, 1), panX: asNum(flags.panX, 0), panY: asNum(flags.panY, 0) });
        await page.waitForTimeout(400);
      }

      // Optional HAR capture
      const harState = flags.har ? await startHarCapture(page) : null;
      await page.screenshot({ path: out, fullPage: asBool(flags.full, false) });
      const meta = { url, out, ts: nowIso(), status: r.status, title: r.title, viewport, flags: { ...flags } };
      if (harState) {
        const har = stopHarCapture(page);
        const harFile = await writeHar(har, String(flags.har));
        meta.har = harFile;
        meta.harEntryCount = har?._meta?.entryCount || 0;
      }
      await runAfterShoot(ctx, meta);
      return meta;
    })().catch(e => ({ url, out, ts: nowIso(), error: e.message, viewport, flags: { ...flags } }));
  } finally {
    // Run cleanups (remove injected overlay styles)
    for (const fn of cleanups) {
      try { await fn(); } catch {}
    }
    if (ownBrowser) await browser.close();
  }
}

export async function runShootWithSidecar(args) {
  const meta = await runShoot(args);
  await writeSidecar(meta);
  return meta;
}

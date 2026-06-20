// Shared capture-side helpers: page-side CSS overlays, camera control,
// frame stability wait.

export const NAV_TIMEOUT_MS = 90_000;
export const SETTLE_MS = 1200;
export const CLICK_TIMEOUT_MS = 15_000;
export const WAIT_DEFAULT_TIMEOUT_MS = 30_000;

export async function gotoOrThrow(page, url, opts = {}) {
  const timeout = opts.timeoutMs || NAV_TIMEOUT_MS;
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  if (!resp) throw new Error(`No response for ${url}`);
  const status = resp.status();
  if (status >= 400) throw new Error(`HTTP ${status} for ${url}`);
  return { status, title: await page.title() };
}

export async function settle(page) {
  await page.waitForTimeout(SETTLE_MS);
}

// --- overlays ---

export async function overlayCursor(page, kind) {
  if (!kind || kind === "default" || kind === "none") return async () => {};
  const map = { pointer: "pointer", grab: "grab", grabbing: "grabbing", crosshair: "crosshair" };
  const css = map[kind] || "pointer";
  const marker = `/*purr_visual_cursor_${css}*/`;
  await page.addStyleTag({ content: `${marker}\n*, *::before, *::after { cursor: ${css} !important; }` });
  return async () => {
    await page.evaluate((m) => document.querySelectorAll("style").forEach(s => { if (s.textContent && s.textContent.includes(m)) s.remove(); }), marker).catch(() => {});
  };
}

export async function overlayGrid(page, opts = {}) {
  const tile = Math.max(8, Math.min(512, Number(opts.tileSize) || 64));
  // Sanitize color: allow only CSS-safe color tokens (hex, rgba, named)
  const raw = (opts.color || "rgba(255, 0, 255, 0.35)").trim();
  // Reject anything with braces, semicolons, quotes, or HTML — CSS injection guard
  const color = /^[a-zA-Z#()\d\s,%.]+$/.test(raw) ? raw : "rgba(255, 0, 255, 0.35)";
  await page.evaluate(({ tile, color }) => {
    let s = document.getElementById("__purr_visual_grid__");
    if (s) s.remove();
    s = document.createElement("style");
    s.id = "__purr_visual_grid__";
    s.textContent = `body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 99999; background-image: linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px); background-size: ${tile}px ${tile}px, ${tile}px ${tile}px; }`;
    document.documentElement.appendChild(s);
  }, { tile, color });
  return async () => {
    await page.evaluate(() => document.getElementById("__purr_visual_grid__")?.remove()).catch(() => {});
  };
}

export async function hideHud(page) {
  const marker = "/*purr_visual_hide_hud*/";
  const css = marker + "\n" + [
    "header, footer, nav { display: none !important; }",
    ".hud-topbar, .bottom-nav { display: none !important; }",
    "[data-pursor-hud=\"hide\"] { display: none !important; }",
  ].join("\n");
  await page.addStyleTag({ content: css });
  return async () => {
    await page.evaluate((m) => document.querySelectorAll("style").forEach(s => { if (s.textContent && s.textContent.includes(m)) s.remove(); }), marker).catch(() => {});
  };
}

export async function isolateLayer(page, layer) {
  if (!layer || layer === "all" || layer === "none") return async () => {};
  let css = "";
  // entity = canvas only (game worlds typically render into <canvas>)
  if (layer === "entity") css = "[class*=\"bottom\"], [class*=\"hud\"], [class*=\"nav\"], [class*=\"bar\"], [class*=\"companion\"] { display: none !important; }";
  else if (layer === "terrain") css = "canvas { display: none !important; }";
  else if (layer === "hud") css = "[class*=\"hud\"], [class*=\"nav\"], [class*=\"bar\"] { display: none !important; }";
  else if (layer === "ui") css = "canvas, header, footer, main > nav { display: none !important; }";
  else throw new Error("unknown layer: " + layer);
  const marker = `/*purr_visual_layer_${layer}*/`;
  await page.addStyleTag({ content: `${marker}\n${css}` });
  return async () => {
    await page.evaluate((m) => document.querySelectorAll("style").forEach(s => { if (s.textContent && s.textContent.includes(m)) s.remove(); }), marker).catch(() => {});
  };
}

export async function freezeAnimation(page, freeze) {
  if (!freeze) return async () => {};
  const marker = "/*purr_visual_freeze*/";
  await page.addStyleTag({ content: `${marker}\n*, *::before, *::after { animation-play-state: paused !important; animation-delay: 0s !important; transition: none !important; }` });
  return async () => {
    await page.evaluate((m) => document.querySelectorAll("style").forEach(s => { if (s.textContent && s.textContent.includes(m)) s.remove(); }), marker).catch(() => {});
  };
}

export async function waitForStableFrame(page, ms) {
  if (!ms || ms <= 0) return;
  const hard = 8000;
  const t0 = Date.now();
  let lastHash = null, lastChange = Date.now();
  while (Date.now() - t0 < hard) {
    let h;
    try {
      h = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return null;
        // Prefer WebGL context (common in game canvases), fall back to 2D
        let ctx, type;
        try {
          ctx = c.getContext("webgl2", { willReadFrequently: false }) || c.getContext("webgl");
          if (ctx) type = "webgl";
        } catch {}
        if (!ctx) {
          try { ctx = c.getContext("2d", { willReadFrequently: true }); type = "2d"; } catch {}
        }
        if (!ctx) return null;
        if (type === "webgl") {
          // Create a small readback for WebGL with complete framebuffer
          const fb = ctx.createFramebuffer();
          ctx.bindFramebuffer(ctx.FRAMEBUFFER, fb);
          const rb = ctx.createRenderbuffer();
          ctx.bindRenderbuffer(ctx.RENDERBUFFER, rb);
          ctx.renderbufferStorage(ctx.RENDERBUFFER, ctx.RGBA4, 4, 4);
          ctx.framebufferRenderbuffer(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.RENDERBUFFER, rb);
          const d = new Uint8Array(64);
          ctx.readPixels(0, 0, 4, 4, ctx.RGBA, ctx.UNSIGNED_BYTE, d);
          let acc = 0; for (let i = 0; i < d.length; i += 4) acc = (acc * 31 + d[i]) | 0;
          return acc.toString(36);
        } else {
          const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 32, 32).data;
          let acc = 0; for (let i = 0; i < d.length; i += 64) acc = (acc * 31 + d[i]) | 0;
          return acc.toString(36);
        }
      });
    } catch {
      // page detached mid-poll — give up
      return;
    }
    if (h && h === lastHash) { if (Date.now() - lastChange >= ms) return; }
    else { lastHash = h; lastChange = Date.now(); }
    await page.waitForTimeout(120);
  }
}

// --- camera ---

export async function applyCamera(page, opts = {}) {
  if (!opts) return;
  const zoom = Number(opts.zoom) || 1;
  const panX = Number(opts.panX) || 0;
  const panY = Number(opts.panY) || 0;
  const center = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!center) return;
  if (zoom !== 1) {
    const factor = Math.log2(zoom) * 8;
    const delta = -120 * (factor > 0 ? 1 : -1);
    for (let i = 0; i < Math.max(1, Math.abs(Math.round(factor))); i++) {
      await page.mouse.move(center.x, center.y);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(50);
    }
  }
  if (panX || panY) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + panX, center.y + panY, { steps: 10 });
    await page.mouse.up();
  }
}
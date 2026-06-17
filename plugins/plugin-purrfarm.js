// Built-in plugin: PurrFarm-specific knowledge.
//
// This is a reference for what a domain plugin can do. It:
//   - registers the PurrFarm viewport (alias for desktop-1280 with farm
//     viewport pixel-dimensions that match the actual canvas size)
//   - adds a `nav` sweep-op that clicks each bottom-nav button in turn
//     and captures a frame for each
//   - augments every shoot sidecar with a `purrfarm: { mode }` field
//     so the sweep report can quickly tell which UI mode was active

export default {
  name: "purrfarm",

  viewport: {
    "purrfarm-canvas": { width: 1280, height: 800, dpr: 1, label: "PurrFarm canvas 1280x800" },
    "purrfarm-zoom-150": { width: 1280, height: 800, dpr: 1.5, label: "PurrFarm @1.5x (Retina-ish)" },
  },

  flagHelp: {
    "purrfarm-mode": "logical UI mode the page is in (farm / build / decor / bag / etc.). Recorded in sidecar.",
  },

  sweepOp: {
    "nav": async (ctx, opts) => {
      // opts: { buttons: ["Bag","Tools","Feed","Build","Decor"], settleMs? }
      const browser = ctx.browser;
      const page = ctx.page || await (await import("../src/runway.js")).newPage(browser, (await import("../src/viewport.js")).resolveViewport({}));
      const url = ctx.url;
      if (!url) throw new Error("nav: missing url (provide plan.base)");
      const { gotoOrThrow, settle } = await import("../src/overlays.js");
      const { resolveLocator } = await import("../src/selector.js");
      const r = await gotoOrThrow(page, url); await settle(page);
      const buttons = opts.buttons || ["Bag", "Tools", "Feed", "Build", "Decor"];
      const frames = [];
      for (const label of buttons) {
        try {
          const loc = await resolveLocator(page, `text=${label}`);
          await loc.first().waitFor({ state: "visible", timeout: 5000 });
          await loc.first().click({ timeout: 5000 });
          await page.waitForTimeout(opts.settleMs || 600);
          const f = ctx.out.replace(/\.png$/i, `-${label.toLowerCase()}.png`);
          await page.screenshot({ path: f, fullPage: false });
          frames.push({ button: label, out: f });
        } catch (e) {
          frames.push({ button: label, error: e.message });
        }
      }
      return { ...r, url, mode: "nav-sweep", frames };
    },
  },

  beforeShoot: async (ctx) => {
    if (ctx.flags["purrfarm-mode"]) {
      ctx._purrfarmMode = ctx.flags["purrfarm-mode"];
    }
  },

  afterShoot: async (ctx, meta) => {
    if (ctx._purrfarmMode) meta.purrfarm = { mode: ctx._purrfarmMode };
  },
};
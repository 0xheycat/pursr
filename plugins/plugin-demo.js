// Built-in demo plugin — shows every plugin API surface.
//
// Serves as both a reference implementation AND a useful tool:
//   pursr - adds a `demo-canvas` viewport alias
//   pursr - adds a `nav` sweep-op that clicks each navbar link in turn
//     and captures a screenshot per page
//   pursr - augments sidecar with `demo: { mode }` when `--demo-mode` flag is set
//
// Copy this file as a starting point for your own plugin.

import { newPage } from "../src/runway.js";
import { resolveViewport } from "../src/viewport.js";
import { gotoOrThrow, settle } from "../src/overlays.js";
import { resolveLocator } from "../src/selector.js";

export default {
  name: "demo",

  viewport: {
    "demo-canvas": { width: 1280, height: 800, dpr: 1, label: "Demo canvas 1280x800" },
  },

  flagHelp: {
    "demo-mode": "logical mode label recorded in sidecar (e.g. dark / light / settings).",
  },

  sweepOp: {
    "nav": async (ctx, opts) => {
      // opts: { buttons: string[], settleMs?: number }
      const browser = ctx.browser;
      const page = ctx.page || await newPage(browser, resolveViewport({}));
      const url = ctx.url;
      if (!url) throw new Error("nav: missing url (provide plan.base)");
      const r = await gotoOrThrow(page, url); await settle(page);
      const buttons = opts.buttons || ["Home", "About", "Services", "Portfolio", "Contact"];
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
    if (ctx.flags["demo-mode"]) {
      ctx._demoMode = ctx.flags["demo-mode"];
    }
  },

  afterShoot: async (ctx, meta) => {
    if (ctx._demoMode) meta.demo = { mode: ctx._demoMode };
  },
};

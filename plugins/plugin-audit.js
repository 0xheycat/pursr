// Built-in plugin: axe-core accessibility audit.
//
// Adds:
//   viewport  "audit-canvas"     — 1280x800 @1x ideal for audit screenshots
//   sweepOp   "audit"            — run axe-core WCAG audit in a sweep plan
//   sweepOp   "every-viewport"   — capture every viewport preset
//
// The audit sweep-op stores results to ctx.out/audit.json plus a
// highlighted screenshot. This is a thin wrapper around src/plugin-audit.js
// that exposes the same functionality through the plugin system.

import { runAudit } from "../src/plugin-audit.js";
import { launch, newPage } from "../src/runway.js";
import { listViewports, resolveViewport } from "../src/viewport.js";
import { runShootWithSidecar } from "../src/shoot.js";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

export default {
  name: "audit",

  viewport: {
    "audit-canvas": { width: 1280, height: 800, dpr: 1, label: "Audit canvas 1280x800" },
  },

  sweepOp: {
    // Run axe-core accessibility audit
    "audit": async (ctx, opts) => {
      const url = opts.url || ctx.url;
      if (!url) throw new Error("audit: missing url");
      const tags = opts.tags ? opts.tags.split(",").map(t => t.trim()) : undefined;
      const outDir = opts.outDir || ctx.out?.replace(/\.png$/i, "-audit") || join(process.cwd(), `audit-${Date.now()}`);
      const result = await runAudit({ url, tags, outDir, screenshot: opts.screenshot !== false });
      return { url, mode: "audit", outDir, violations: result.violationSummary?.total || 0, summary: result.violationSummary };
    },

    // Capture one shot per viewport preset
    "every-viewport": async (ctx, opts) => {
      const url = opts.base || ctx.url;
      if (!url) throw new Error("every-viewport: missing base url");
      const wanted = opts.viewports?.length ? opts.viewports : listViewports().map(v => v.name);
      const dir = ctx.out.replace(/\.png$/i, "-every-viewport");
      const captures = [];
      for (const name of wanted) {
        const out = join(dir, `${name}.png`);
        try {
          const meta = await runShootWithSidecar({ url, out, flags: { preset: name } });
          captures.push({ name, out, ok: true, meta });
        } catch (e) {
          captures.push({ name, out, ok: false, error: e.message });
        }
      }
      writeFileSync(join(dir, "every-viewport.json"), JSON.stringify({ url, captures, ts: new Date().toISOString() }, null, 2));
      return { url, mode: "every-viewport", outDir: dir, captures };
    },
  },
};

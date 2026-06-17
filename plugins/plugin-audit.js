// Built-in plugin: convenience aliases for the most common visual
// audit flags. Adds preset viewport `audit-canvas` (1280x800 @1x with
// no device scale) and a sweep-op `full` that captures one shot at
// every viewport preset.

export default {
  name: "audit",

  viewport: {
    "audit-canvas": { width: 1280, height: 800, dpr: 1, label: "Audit canvas 1280x800" },
  },

  sweepOp: {
    "every-viewport": async (ctx, opts) => {
      // opts: { base: <url>?, viewports: <string[]>? }
      const { launch, newPage } = await import("../src/runway.js");
      const { listViewports, resolveViewport } = await import("../src/viewport.js");
      const { runShootWithSidecar } = await import("../src/shoot.js");
      const { join } = await import("node:path");
      const { writeFileSync } = await import("node:fs");
      const url = opts.base || ctx.url;
      if (!url) throw new Error("every-viewport: missing base url");
      const wanted = opts.viewports && opts.viewports.length
        ? opts.viewports
        : listViewports().map(v => v.name);
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
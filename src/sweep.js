// Sweep: batch capture plan. Each step is one of:
//   { name, shoot:  { url?, preset?, ...flags } }
//   { name, hover:  { url?, selector } }
//   { name, frames: { url?, count, intervalMs } }
//   { name, diff:   { url?, ref, threshold? } }
//   { name, <customOp>: { ... } }   // from a registered plugin

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { runShootWithSidecar } from "./shoot.js";
import { runFrames } from "./frames.js";
import { runDiff } from "./diff.js";
import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";
import { resolveHealedSelector } from "./selector-heal.js";
import { asNum, nowIso, findStepPng, renderSweepHtml } from "./util.js";
import { getSweepOp } from "./plugin.js";
import { writeCiOutput } from "./ci-output.js";

export async function runSweep(planPath, outDirArg) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) throw new Error("sweep plan: missing steps[]");
  if (!plan.steps.length) throw new Error("sweep plan: steps[] is empty");
  const dir = outDirArg ?? plan.outDir ?? join(plan.outBase || ".", `sweep-${plan.name || "plan"}`);
  mkdirSync(dir, { recursive: true });
  const summary = { plan: pathResolve(planPath), outDir: dir, name: plan.name || null, steps: [], ts: nowIso() };
  const browser = await launch();
  try {
    // Per-step runner: returns an entry for the summary.
    async function runStep(i) {
      const s = plan.steps[i] || {};
      const stepName = s.name || `step-${i}`;
      const stepOut = join(dir, `${String(i).padStart(2, "0")}-${stepName}.png`);
      const t0 = Date.now();
      const stepKeys = Object.keys(s).filter(k => k !== "name");
      if (!stepKeys.length) throw new Error(`step ${i} has no operation key (only "name"?)`);
      if (stepKeys.length > 1) throw new Error(`step ${i} has ${stepKeys.length} operation keys (${stepKeys.join(", ")}). Only one allowed per step.`);
      const opKey = stepKeys[0];
      const entry = { i, name: stepName, op: opKey };
      try {
        if (s.shoot) {
          const url = s.shoot.url || (plan.base ? plan.base : null);
          if (!url) throw new Error("shoot: missing url (and no plan.base)");
          const flags = Object.fromEntries(Object.entries(s.shoot).filter(([k]) => k !== "url").map(([k, v]) => [k, v]));
          const meta = await runShootWithSidecar({ url, out: stepOut, flags, browser });
          entry.meta = meta;
        } else if (s.hover) {
          const url = s.hover.url || (plan.base ? plan.base : null);
          if (!url) throw new Error("hover: missing url (and no plan.base)");
          const selector = s.hover.selector;
          if (!selector) throw new Error("hover: missing selector");
          const viewport = resolveViewport(s.hover);
          const page = await newPage(browser, viewport);
          const r = await gotoOrThrow(page, url); await settle(page);
          const healed = await resolveHealedSelector(page, selector);
          await healed.locator.first().hover({ timeout: CLICK_TIMEOUT_MS });
          await page.waitForTimeout(asNum(s.hover.settleMs, 300));
          await page.screenshot({ path: stepOut, fullPage: false });
          await page.close();
          entry.meta = { ...r, url, out: stepOut, selector, viewport };
        } else if (s.frames) {
          const url = s.frames.url || (plan.base ? plan.base : null);
          if (!url) throw new Error("frames: missing url (and no plan.base)");
          const subDir = join(dir, `${String(i).padStart(2, "0")}-${stepName}-frames`);
          const meta = await runFrames({ url, count: asNum(s.frames.count, 8), intervalMs: asNum(s.frames.intervalMs, 200), outDir: subDir, flags: s.frames, browser });
          entry.meta = meta;
        } else if (s.diff) {
          const refName = s.diff.ref;
          if (!refName) throw new Error("diff: missing ref (step name or filename)");
          const refPath = findStepPng(dir, refName);
          if (!refPath) throw new Error(`diff: ref not found in dir: ${refName}`);
          const url = s.diff.url || (plan.base ? plan.base : null);
          if (!url) throw new Error("diff: missing url (and no plan.base)");
          const meta = await runDiff(url, refPath, stepOut, asNum(s.diff.threshold, 0.1), browser);
          entry.meta = meta;
        } else if (opKey && getSweepOp(opKey)) {
          const customOp = getSweepOp(opKey);
          if (typeof customOp !== "function") throw new Error(`custom op "${opKey}" is not a function`);
          const ctx = { url: plan.base, out: stepOut, browser, page: null };
          const result = await customOp(ctx, s[opKey] || {});
          entry.meta = result != null ? result : { out: stepOut };
        } else {
          throw new Error(`step "${opKey}": unknown or unregistered operation`);
        }
        entry.ms = Date.now() - t0; entry.ok = true;
      } catch (e) {
        entry.ok = false; entry.error = e.message; entry.ms = Date.now() - t0;
      }
      return entry;
    }

    // Schedule: serial by default, or via a worker pool when plan.parallel > 1.
    const poolSize = Math.max(1, Number(plan.parallel) || 1);
    const results = new Array(plan.steps.length);
    if (poolSize === 1) {
      for (let i = 0; i < plan.steps.length; i++) {
        results[i] = await runStep(i);
      }
    } else {
      let cursor = 0;
      async function worker() {
        while (true) {
          const idx = cursor++;
          if (idx >= plan.steps.length) return;
          results[idx] = await runStep(idx);
        }
      }
      const workers = Array.from({ length: Math.min(poolSize, plan.steps.length) }, () => worker());
      await Promise.all(workers);
    }
    for (const r of results) summary.steps.push(r);
  } finally { try { await browser.close(); } catch {} }
  writeFileSync(join(dir, "sweep.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(dir, "index.html"), renderSweepHtml(summary));
  try { writeCiOutput(summary, dir); } catch (e) { console.error("[pursr] CI output error:", e.message); }
  return summary;
}
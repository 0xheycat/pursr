// Sweep: batch capture plan. Each step is one of:
//   { name, shoot:  { url?, preset?, ...flags } }
//   { name, hover:  { url?, selector } }
//   { name, frames: { url?, count, intervalMs } }
//   { name, diff:   { url?, ref, threshold? } }
//   { name, <customOp>: { ... } }   // from a registered plugin

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { runShootWithSidecar } from "./shoot.js";
import { runHover } from "./hover.js";
import { runFrames } from "./frames.js";
import { runDiff } from "./diff.js";
import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";
import { asNum, nowIso, findStepPng, renderSweepHtml } from "./util.js";
import { getSweepOp } from "./plugin.js";

export async function runSweep(planPath, outDirArg) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (!plan.steps || !Array.isArray(plan.steps)) throw new Error("sweep plan: missing steps[]");
  const dir = outDirArg || plan.outDir || join(plan.outBase || ".", `sweep-${plan.name || "plan"}`);
  mkdirSync(dir, { recursive: true });
  const summary = { plan: pathResolve(planPath), outDir: dir, name: plan.name || null, steps: [], ts: nowIso() };
  const browser = await launch();
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i] || {};
      const stepName = s.name || `step-${i}`;
      const stepOut = join(dir, `${String(i).padStart(2, "0")}-${stepName}.png`);
      const t0 = Date.now();
      const opKey = Object.keys(s).find(k => k !== "name");
      const entry = { i, name: stepName, op: opKey };
      try {
        if (s.shoot) {
          const url = s.shoot.url || plan.base;
          if (!url) throw new Error("shoot: missing url (and no plan.base)");
          const flags = Object.fromEntries(Object.entries(s.shoot).filter(([k]) => k !== "url").map(([k, v]) => [k, v]));
          const meta = await runShootWithSidecar({ url, out: stepOut, flags });
          entry.meta = meta;
        } else if (s.hover) {
          const url = s.hover.url || plan.base;
          const selector = s.hover.selector;
          if (!selector) throw new Error("hover: missing selector");
          const viewport = resolveViewport({});
          const page = await newPage(browser, viewport);
          const r = await gotoOrThrow(page, url); await settle(page);
          const loc = await resolveLocator(page, selector);
          await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
          await loc.first().hover({ timeout: CLICK_TIMEOUT_MS });
          await page.waitForTimeout(300);
          await page.screenshot({ path: stepOut, fullPage: false });
          await page.close();
          entry.meta = { ...r, url, out: stepOut, selector };
        } else if (s.frames) {
          const url = s.frames.url || plan.base;
          const subDir = join(dir, `${String(i).padStart(2, "0")}-${stepName}-frames`);
          const meta = await runFrames({ url, count: asNum(s.frames.count, 8), intervalMs: asNum(s.frames.intervalMs, 200), outDir: subDir, flags: {} });
          entry.meta = meta;
        } else if (s.diff) {
          const refName = s.diff.ref;
          if (!refName) throw new Error("diff: missing ref (step name or filename)");
          const refPath = findStepPng(dir, refName);
          if (!refPath) throw new Error(`diff: ref not found in dir: ${refName}`);
          const url = s.diff.url || plan.base;
          const meta = await runDiff(url, refPath, stepOut, asNum(s.diff.threshold, 0.1));
          entry.meta = meta;
        } else if (opKey && getSweepOp(opKey)) {
          const customOp = getSweepOp(opKey);
          const ctx = { url: plan.base, out: stepOut, browser, page: null };
          const result = await customOp(ctx, s[opKey] || {});
          entry.meta = result || { out: stepOut };
        } else {
          throw new Error("step: must have one of shoot/hover/frames/diff or a custom plugin op");
        }
        entry.ms = Date.now() - t0; entry.ok = true;
      } catch (e) {
        entry.ok = false; entry.error = e.message; entry.ms = Date.now() - t0;
      }
      summary.steps.push(entry);
    }
  } finally { await browser.close(); }
  writeFileSync(join(dir, "sweep.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(dir, "index.html"), renderSweepHtml(summary));
  return summary;
}
//  pursr — CI-friendly visual regression check.
//
// Renders a URL at a given (url + viewport + flags) and diffs it against the
// stored baseline (identified by the same diffKey). Exits 0 if equal, 1 if
// different, 2 if no baseline.

import { resolveViewport } from "./viewport.js";
import { diffKey, loadBaseline, approveBaseline } from "./baseline.js";
import { runDiff } from "./diff.js";
import { makeOut, nowIso } from "./util.js";

export async function runCheck({ url, flags = {}, project = null, threshold = 0.1, update = false, out = null, baselineStep = "default" }) {
  if (!url) throw new Error("runCheck: missing url");
  // Strip action-only flags that don't affect rendering. If they were part of the
  // diffKey, the same URL+preset combo would hash differently depending on which
  // CLI flags the user passed, which is wrong.
  const renderFlags = {};
  for (const [k, v] of Object.entries(flags || {})) {
    if (k === "update" || k === "threshold" || k === "out" || k === "json" || k === "project") continue;
    renderFlags[k] = v;
  }
  const viewport = resolveViewport(renderFlags);
  const id = diffKey({ url, viewport, flags: renderFlags });
  let proj = project;
  if (!proj) {
    try { const u = new URL(url); proj = u.origin + (u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "")); }
    catch { proj = url; }
  }
  const loaded = loadBaseline({ project: proj, id, step: baselineStep });
  if (!loaded) {
    return {
      url, flags, viewport, baselineKey: { project: proj, id, step: baselineStep },
      status: "no-baseline",
      exitCode: 2,
      ts: nowIso(),
      hint: "No baseline found. Run `pursr shoot " + url + " --save-baseline` first, or `pursr check " + url + " --update` to capture the current render as the new baseline.",
    };
  }
  const diffOut = out || makeOut("check-diff.png");
  const result = await runDiff(url, loaded.png, diffOut, threshold, flags);
  if (result.error === "size mismatch") {
    return {
      url, flags, viewport, baselineKey: { project: proj, id, step: baselineStep },
      refPng: loaded.png, currentPath: result.currentPath, out: diffOut,
      status: "size-mismatch",
      equal: false,
      refSize: result.refSize, currentSize: result.currentSize,
      exitCode: 1,
      ts: nowIso(),
      hint: "Reference baseline is " + result.refSize.w + "x" + result.refSize.h + " but current render is " + result.currentSize.w + "x" + result.currentSize.h + ". Re-baseline with the same viewport.",
    };
  }
  if (update || result.numDiff === 0) {
    const currentPng = result.currentPath;
    const saved = (update || result.numDiff > 0) ? approveBaseline({ project: proj, id, step: baselineStep, fromPng: currentPng }) : null;
    return {
      url, flags, viewport, baselineKey: { project: proj, id, step: baselineStep },
      refPng: loaded.png, currentPath: currentPng, out: diffOut,
      refSize: result.refSize, totalPx: result.totalPx, numDiff: result.numDiff, diffPct: result.diffPct, threshold,
      status: result.numDiff === 0 ? "equal" : "updated",
      equal: result.numDiff === 0,
      exitCode: 0,
      saved: saved ? { ts: saved.ts, sha1: saved.sha1, approvedFrom: saved.approvedFrom } : null,
      ts: nowIso(),
    };
  }
  return {
    url, flags, viewport, baselineKey: { project: proj, id, step: baselineStep },
    refPng: loaded.png, currentPath: result.currentPath, out: diffOut,
    refSize: result.refSize, totalPx: result.totalPx, numDiff: result.numDiff, diffPct: result.diffPct, threshold,
    status: "differ",
    equal: false,
    exitCode: 1,
    ts: nowIso(),
    hint: "Differences detected (" + result.numDiff + " px, " + result.diffPct + "%). Run `pursr check " + url + " --update` to approve the current render as the new baseline.",
  };
}
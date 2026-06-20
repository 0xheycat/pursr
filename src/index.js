// pursor — public library API.
//
// This is the entry point for consumers who want to embed pursor
// inside their own scripts (instead of using the CLI). The CLI in
// bin/pursor.mjs is a thin wrapper around the same exports.
//
// All capture / sweep helpers return a `Result` object: the path to the
// PNG, a sidecar JSON metadata object, and timing info. They never throw
// on capture-time errors — those are reported in the result so the
// caller can decide how to react.
//
// The plugin system lives in src/plugin.js — see that file for how to
// write a custom plugin (viewport, sweep-op, before/after hooks).

import { runShoot } from "./shoot.js";
import { runSweep } from "./sweep.js";
import { runEveryViewport } from "./every-viewport.js";
import { runFrames } from "./frames.js";
import { runHover } from "./hover.js";
import { runDiff, runDiffWithAi } from "./diff.js";
import { runProbe } from "./probe.js";
import { runShot } from "./shot.js";
import { runEval } from "./eval.js";
import { runClick, runType, runWait, runSeq } from "./interact.js";
import { listViewports, resolveViewport, VIEWPORTS } from "./viewport.js";
import { applyCamera, waitForStableFrame } from "./overlays.js";
import { loadPlugins, registerPlugin, listPlugins, getSweepOp, getViewportPreset, listViewportPresets, getFlagHelp } from "./plugin.js";
import { launch, newPage } from "./runway.js";
import { parseFlags, asNum, asBool, nowIso, shortHash, escapeHtml, renderSweepHtml, renderEveryViewportHtml, findStepPng, readArg, makeOut } from "./util.js";
import { resolveLocator, parseTextSelector } from "./selector.js";
import { captureDomSnapshot, captureDomSnapshotSidecar } from "./dom-snapshot.js";
import { runAudit } from "./plugin-audit.js";
import { resolveHealedSelector, healStepAction } from "./selector-heal.js";
import { writeCiOutput } from "./ci-output.js";
import { PursorMCPServer, loadConfig as loadMcpConfig, MCP_VERSION } from "./mcp.js";
import { createRequire } from "node:module";
import { saveBaseline, loadBaseline, listBaselines, approveBaseline, diffKey, resolveBaselinePath } from "./baseline.js";
import { validateSweepPlan, registerSweepOp } from "./sweep-schema.js";
import { listResources, readResource, recordResource } from "./mcp-resources.js";
import { startHarCapture, stopHarCapture, writeHar } from "./har.js";
import { saveAuthState, loadAuthState, listAuthStates, deleteAuthState } from "./auth.js";
import { startWatch, matchGlob, shouldFire } from "./watch.js";
import { runSnap, approveSnapsAsBaselines } from "./snap.js";
import { renderSweepPdf } from "./report.js";
import { aiDiffSummary, aiDiffSidecar } from "./ai-diff.js";


// Derive VERSION from package.json to prevent drift
const __require = createRequire(import.meta.url);
const pkg = __require("../package.json");
const VERSION = pkg.version;

export {
  // CLI-style actions
  runProbe, runShot, runEval, runClick, runType, runWait, runSeq,
  runShoot, runFrames, runHover, runSweep, runDiff, runEveryViewport,
  // v3: audit, DOM snapshot, MCP
  runAudit, captureDomSnapshot, captureDomSnapshotSidecar,
  // viewport + camera helpers
  listViewports, resolveViewport, VIEWPORTS,
  applyCamera, waitForStableFrame,
  // plugin system
  loadPlugins, registerPlugin, listPlugins, getSweepOp, getViewportPreset, listViewportPresets, getFlagHelp,
  // low-level helpers (for plugin authors)
  launch, newPage,
  parseFlags, asNum, asBool, nowIso, shortHash, escapeHtml, renderSweepHtml, renderEveryViewportHtml, findStepPng, readArg, makeOut,
  resolveLocator, parseTextSelector,
  // v3: selector healing, CI output, MCP server
  resolveHealedSelector, healStepAction,
  writeCiOutput,
  PursorMCPServer, loadMcpConfig, MCP_VERSION,
  // v4: baselines, sweep validation, MCP resources
  saveBaseline, loadBaseline, listBaselines, approveBaseline, diffKey, resolveBaselinePath,
  validateSweepPlan, registerSweepOp,
  listResources, readResource, recordResource,
  // v5: HAR capture, auth state, parallel sweep
  startHarCapture, stopHarCapture, writeHar,
  saveAuthState, loadAuthState, listAuthStates, deleteAuthState,
  // v6: watch mode, component snapshot
  startWatch, matchGlob, shouldFire,
  runSnap, approveSnapsAsBaselines,
  // v6: PDF report, AI diff summary
  runDiffWithAi,
  renderSweepPdf,
  aiDiffSummary, aiDiffSidecar,
  VERSION,
};

export default {
  runProbe, runShot, runEval, runClick, runType, runWait, runSeq,
  runShoot, runFrames, runHover, runSweep, runDiff, runEveryViewport,
  runAudit, captureDomSnapshot, captureDomSnapshotSidecar,
  listViewports, resolveViewport, VIEWPORTS,
  applyCamera, waitForStableFrame,
  loadPlugins, registerPlugin, listPlugins, getSweepOp, getViewportPreset, listViewportPresets, getFlagHelp,
  launch, newPage,
  parseFlags, asNum, asBool, nowIso, shortHash, escapeHtml, renderSweepHtml, renderEveryViewportHtml, findStepPng, readArg, makeOut,
  resolveLocator, parseTextSelector,
  resolveHealedSelector, healStepAction,
  writeCiOutput,
  PursorMCPServer, loadMcpConfig, MCP_VERSION,
  saveBaseline, loadBaseline, listBaselines, approveBaseline, diffKey, resolveBaselinePath,
  validateSweepPlan, registerSweepOp,
  listResources, readResource, recordResource,
  // v6: PDF report, AI diff summary
  runDiffWithAi, renderSweepPdf, aiDiffSummary, aiDiffSidecar,
  VERSION,
};
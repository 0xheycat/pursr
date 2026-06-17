// @purr/visual — public library API.
//
// This is the entry point for consumers who want to embed purr-visual
// inside their own scripts (instead of using the CLI). The CLI in
// bin/purr-visual.mjs is a thin wrapper around the same exports.
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
import { runFrames } from "./frames.js";
import { runHover } from "./hover.js";
import { runDiff } from "./diff.js";
import { runProbe } from "./probe.js";
import { runShot } from "./shot.js";
import { runEval } from "./eval.js";
import { runClick, runType, runWait, runSeq } from "./interact.js";
import { listViewports, resolveViewport, VIEWPORTS } from "./viewport.js";
import { applyCamera, waitForStableFrame } from "./overlays.js";
import { loadPlugins, registerPlugin, listPlugins } from "./plugin.js";

export {
  // CLI-style actions
  runProbe, runShot, runEval, runClick, runType, runWait, runSeq,
  runShoot, runFrames, runHover, runSweep, runDiff,
  // viewport + camera helpers
  listViewports, resolveViewport, VIEWPORTS,
  applyCamera, waitForStableFrame,
  // plugin system
  loadPlugins, registerPlugin, listPlugins,
};

export const VERSION = "0.1.0";
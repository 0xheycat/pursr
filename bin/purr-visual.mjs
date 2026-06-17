#!/usr/bin/env node
// purr-visual CLI. Thin wrapper around src/* that mirrors the npm bin.

import { VERSION } from "../src/index.js";
import { runClick, runType, runWait, runSeq } from "../src/interact.js";
import { runEval } from "../src/eval.js";
import { runProbe } from "../src/probe.js";
import { runShot } from "../src/shot.js";
import { runShootWithSidecar } from "../src/shoot.js";
import { runHover } from "../src/hover.js";
import { runFrames } from "../src/frames.js";
import { runDiff } from "../src/diff.js";
import { runSweep } from "../src/sweep.js";
import { listViewports, resolveViewport } from "../src/viewport.js";
import { parseFlags, asNum, asBool, readArg, makeOut, pickOutPath, nowIso } from "../src/util.js";
import { loadPlugins, listPlugins, getFlagHelp } from "../src/plugin.js";

const USAGE = `usage:
  v1: purr-visual {probe|shot|full|eval|click|type|wait|diff|seq} <url> [...]
  v2: purr-visual {viewports|shoot|layer|frames|hover|sweep} <...>
  flags: --preset <name> --width N --height N --dpr N
         --zoom 1.5 --panX 200 --panY -100
         --cursor pointer|grab|grabbing|crosshair|none
         --layer entity|terrain|hud|ui
         --grid --grid-tile 64 --grid-color rgba(255,0,255,0.35)
         --no-animation --wait-frame 600 --full
  @file prefix reads argv contents from file (UTF-8, newline trimmed).
  plugins: purr-visual automatically loads built-in plugins from plugins/.
  You can also pass --plugin <path> to load custom plugins (repeatable).`;

function die(msg, code = 2) {
  console.error(JSON.stringify({ error: msg, usage: USAGE }, null, 2));
  process.exit(code);
}

const argv = process.argv;
const [, , cmd, a, b, c, d] = argv;
const url = process.env.PURR_VISUAL_URL || a;

// Plugin loading: scan for --plugin <path> and built-in plugins/
const pluginPaths = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--plugin" && i + 1 < argv.length) pluginPaths.push(argv[++i]);
await loadPlugins(pluginPaths);

(async () => {
  try {
    switch (cmd) {
      case "version": case "--version": case "-v": {
        console.log(JSON.stringify({ name: "@purr/visual", version: VERSION, plugins: listPlugins() }, null, 2));
        break;
      }
      case "probe": { if (!url) die("missing url"); const r = await runProbe(url); console.log(JSON.stringify(r, null, 2)); break; }
      case "shot": { if (!url) die("missing url"); const out = b || makeOut("shot.png"); const r = await runShot(url, out, { fullPage: false }); console.log(JSON.stringify(r, null, 2)); break; }
      case "full": { if (!url) die("missing url"); const out = b || makeOut("full.png"); const r = await runShot(url, out, { fullPage: true }); console.log(JSON.stringify(r, null, 2)); break; }
      case "eval": { if (!url) die("missing url"); const js = readArg(b); if (!js) die("eval: missing <js> (or @file)"); const out = c || makeOut("eval.png"); const r = await runEval(url, js, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "click": { if (!url) die("missing url"); const sel = b; if (!sel) die("click: missing <selector>"); const out = c || makeOut(`click-${(sel||"").replace(/[^a-z0-9]+/gi, "_").slice(0, 32)}.png`); const r = await runClick(url, sel, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "type": { if (!url) die("missing url"); const sel = b; const text = readArg(c); if (!sel || text === undefined) die("type: missing <selector> or <text> (text can be @file)"); const out = d || makeOut(`type-${(sel||"").replace(/[^a-z0-9]+/gi, "_").slice(0, 32)}.png`); const r = await runType(url, sel, text, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "wait": { if (!url) die("missing url"); const sel = b; if (!sel) die("wait: missing <selector>"); const t = c ? Number(c) : 30000; const r = await runWait(url, sel, t); console.log(JSON.stringify(r, null, 2)); break; }
      case "diff": { if (!url) die("missing url"); const ref = b; if (!ref) die("diff: missing <ref.png>"); const out = c || makeOut("diff.png"); const threshold = d !== undefined ? Number(d) : 0.1; const r = await runDiff(url, ref, out, threshold); console.log(JSON.stringify(r, null, 2)); break; }
      case "seq": { if (!url) die("missing url"); const actions = readArg(b); if (!actions) die("seq: missing <actions.json> (or @file)"); const out = c || makeOut("seq.png"); const r = await runSeq(url, actions, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "viewports": { console.log(JSON.stringify(listViewports(), null, 2)); break; }
      case "shoot": {
        if (!url) die("missing url");
        const out = (b && !b.startsWith("--")) ? b : pickOutPath(argv.slice(5)) || makeOut("shoot.png");
        const r = await runShootWithSidecar({ url, out, flags: parseFlags(argv.slice(5)) });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "layer": {
        if (!url) die("missing url");
        const layerName = b; if (!layerName) die("layer: missing <name>");
        const out = (c && !c.startsWith("--")) ? c : pickOutPath(argv.slice(6)) || makeOut(`layer-${layerName}.png`);
        const flags = parseFlags(argv.slice(6)); flags.layer = layerName;
        const r = await runShootWithSidecar({ url, out, flags });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "frames": {
        if (!url) die("missing url");
        const count = asNum(b, 8);
        const stepMs = asNum(c, 250);
        const outDir = (d && !d.startsWith("--")) ? d : makeOut(`frames-${count}x${stepMs}ms`);
        const r = await runFrames({ url, count, intervalMs: stepMs, outDir, flags: parseFlags(argv.slice(7)) });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "hover": {
        if (!url) die("missing url");
        const sel = b; if (!sel) die("hover: missing <selector>");
        const out = (c && !c.startsWith("--")) ? c : pickOutPath(argv.slice(6)) || makeOut(`hover-${(sel||"").replace(/[^a-z0-9]+/gi, "_").slice(0, 32)}.png`);
        const r = await runHover({ url, selector: sel, out, flags: parseFlags(argv.slice(6)) });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "sweep": {
        const planPath = readArg(a);
        if (!planPath) die("sweep: missing <plan.json> (or @file)");
        const outDirArg = (b && !b.startsWith("--")) ? b : undefined;
        const r = await runSweep(planPath, outDirArg);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      default: { die(`unknown subcommand: ${cmd}`); }
    }
  } catch (e) {
    console.error(JSON.stringify({ error: e.message, stack: e.stack?.split("\n").slice(0, 3).join("\n") }, null, 2));
    process.exit(1);
  }
})();
#!/usr/bin/env node
// pursor CLI. Thin wrapper around src/* that mirrors the npm bin.

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
import { runEveryViewport } from "../src/every-viewport.js";
import { runAudit } from "../src/plugin-audit.js";
import { captureDomSnapshot } from "../src/dom-snapshot.js";
import { listViewports } from "../src/viewport.js";
import { parseFlags, asNum, readArg, makeOut, pickOutPath } from "../src/util.js";
import { writeFileSync } from "node:fs";
import { readFileSync as _readFileSync } from "node:fs";
const readFile = _readFileSync;
import { loadPlugins, listPlugins, getFlagHelp } from "../src/plugin.js";

const USAGE = `usage:
  v1: pursor {probe|shot|full|eval|click|type|wait|diff|seq} <url> [...]
  v2: pursor {viewports|shoot|layer|frames|hover|sweep} <...>
  flags: --preset <name> --width N --height N --dpr N
         --zoom 1.5 --panX 200 --panY -100
         --cursor pointer|grab|grabbing|crosshair|none
         --layer entity|terrain|hud|ui
         --grid --grid-tile 64 --grid-color rgba(255,0,255,0.35)
         --no-animation --wait-frame 600 --full
  @file prefix reads argv contents from file (UTF-8, newline trimmed).
  plugins: pursor automatically loads built-in plugins from plugins/.
  You can also pass --plugin <path> to load custom plugins (repeatable).`;

function die(msg, code = 2) {
  console.error(JSON.stringify({ error: msg, usage: USAGE }, null, 2));
  process.exit(code);
}

const argv = process.argv;
const [, , cmd, a, b, c, d] = argv;
const url = process.env.PURSOR_URL || a;

// Plugin loading: scan for --plugin <path> and built-in plugins/
const pluginPaths = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--plugin" && i + 1 < argv.length) pluginPaths.push(argv[++i]);
await loadPlugins(pluginPaths);

(async () => {
  try {
    switch (cmd) {
      case undefined: case "help": case "--help": case "-h": { console.log(JSON.stringify({ usage: USAGE }, null, 2)); break; }
      case "version": case "--version": case "-v": {
        console.log(JSON.stringify({ name: "pursor", version: VERSION, plugins: listPlugins() }, null, 2));
        break;
      }
      case "probe": { if (!url) die("missing url"); const r = await runProbe(url); console.log(JSON.stringify(r, null, 2)); break; }
      case "shot": { if (!url) die("missing url"); const out = b || makeOut("shot.png"); const r = await runShot(url, out, { fullPage: false }); console.log(JSON.stringify(r, null, 2)); break; }
      case "full": { if (!url) die("missing url"); const out = b || makeOut("full.png"); const r = await runShot(url, out, { fullPage: true }); console.log(JSON.stringify(r, null, 2)); break; }
      case "eval": { if (!url) die("missing url"); const js = readArg(b); if (!js) die("eval: missing <js> (or @file)"); const out = c || makeOut("eval.png"); const r = await runEval(url, js, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "click": { if (!url) die("missing url"); const sel = b; if (!sel) die("click: missing <selector>"); const out = c || makeOut(`click-${(sel||"").replace(/[^a-z0-9]+/gi, "_").slice(0, 32)}.png`); const r = await runClick(url, sel, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "type": { if (!url) die("missing url"); const sel = b; const text = readArg(c); if (!sel || text === undefined) die("type: missing <selector> or <text> (text can be @file)"); const out = d || makeOut(`type-${(sel||"").replace(/[^a-z0-9]+/gi, "_").slice(0, 32)}.png`); const r = await runType(url, sel, text, out); console.log(JSON.stringify(r, null, 2)); break; }
      case "wait": { if (!url) die("missing url"); const sel = b; if (!sel) die("wait: missing <selector>"); const t = c !== undefined ? asNum(c, 30000) : 30000; const r = await runWait(url, sel, t); console.log(JSON.stringify(r, null, 2)); break; }
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
        const flags = parseFlags(argv.slice(7)); flags.layer = layerName;
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
      case "every-viewport": {
        if (!url) die("missing url");
        const outDir = (b && !b.startsWith("--")) ? b : undefined;
        const viewports = c?.startsWith("--") ? undefined : c?.split(",");
        const r = await runEveryViewport({ url, outDir, viewports });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "audit": {
        if (!url) die("missing url");
        const tags = (b && !b.startsWith("--")) ? b : undefined;
        const outDir = (c && !c.startsWith("--")) ? c : undefined;
        const r = await runAudit({ url, tags: tags?.split(",").map(t => t.trim()), outDir });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "dom-snapshot": case "dom": {
        if (!url) die("missing url");
        const out = (b && !b.startsWith("--")) ? b : undefined;
        const r = await captureDomSnapshot({ url, out });
        console.log(JSON.stringify({ url: r.url, title: r.title, elements: r.selectorMap?.length, domSize: r.dom?.length, out: r.url?.replace(/[^/]+$/, "") + "dom.json" }, null, 2));
        break;
      }
      case "validate": {
        const planPath = readArg(a);
        if (!planPath) die("validate: missing <plan.json> (or @file)");
        let plan;
        try { plan = JSON.parse(readFile(planPath, "utf8")); }
        catch (e) { die("validate: " + e.message); }
        const { validateSweepPlan } = await import("../src/sweep-schema.js");
        const v = validateSweepPlan(plan);
        console.log(JSON.stringify({ valid: v.valid, errors: v.errors, plan: planPath }, null, 2));
        if (!v.valid) process.exit(1);
        break;
      }
      case "baseline": {
        // pursor baseline <sub> [...args]
        //   sub=list                    -> list baselines
        //   sub=save <project> <png> <step>  [--id <id>] [--url <u>] [--meta-json <file>]
        //   sub=approve <project> <png> <step>  [--id <id>] [--url <u>]
        //   sub=show <project> <step>    [--id <id>] [--url <u>]
        const sub = a;
        const { saveBaseline, listBaselines, loadBaseline, approveBaseline, diffKey } = await import("../src/baseline.js");
        if (sub === "list") {
          // baseline list [project]
          const project = b;
          console.log(JSON.stringify(listBaselines(project), null, 2));
        } else if (sub === "save") {
          if (!b || !c || !d) die("baseline save: <project> <png> <step> [--id <id>] [--url <u>] [--meta-json <file>]");
          const project = b, png = c, step = d;
          const flags = parseFlags(argv.slice(7));
          let meta = null;
          if (flags["meta-json"]) meta = JSON.parse(readFile(flags["meta-json"], "utf8"));
          else if (flags.url) meta = { url: flags.url };
          const id = flags.id || diffKey({ url: meta?.url || "", viewport: meta?.viewport, flags: meta?.flags || {} });
          const result = saveBaseline({ project, id, step, png, meta });
          console.log(JSON.stringify({ saved: true, ...result }, null, 2));
        } else if (sub === "approve") {
          if (!b || !c || !d) die("baseline approve: <project> <png> <step> [--id <id>] [--url <u>]");
          const project = b, png = c, step = d;
          const flags = parseFlags(argv.slice(7));
          const id = flags.id || diffKey({ url: flags.url || "", flags: {} });
          const result = approveBaseline({ project, id, step, fromPng: png });
          console.log(JSON.stringify({ approved: true, ...result }, null, 2));
        } else if (sub === "show") {
          if (!b || !c) die("baseline show: <project> <step> [--id <id>] [--url <u>]");
          const project = b, step = c;
          const flags = parseFlags(argv.slice(5));
          const id = flags.id || diffKey({ url: flags.url || "", flags: {} });
          const r = loadBaseline({ project, id, step });
          console.log(JSON.stringify(r, null, 2));
        } else {
          die("baseline subcommand: list | save | approve | show");
        }
        break;
      }
      case "auth": {
              // pursor auth <sub> [...args]
              //   save <project> <name> --from <state.json>
              //   load <project> <name> --out <state.json>
              //   list [project]
              //   delete <project> <name>
              const sub = a;
              const { saveAuthState, loadAuthState, listAuthStates, deleteAuthState } = await import("../src/auth.js");
              if (sub === "list") {
                const project = b;
                console.log(JSON.stringify(listAuthStates(project), null, 2));
              } else if (sub === "save") {
                if (!b || !c) die("auth save: <project> <name> --from <state.json>");
                const fromFile = argv[argv.indexOf("--from") + 1];
                if (!fromFile) die("auth save: missing --from <state.json>");
                const state = JSON.parse(readFile(fromFile, "utf8"));
                const r = saveAuthState({ project: b, name: c, state });
                console.log(JSON.stringify({ saved: true, ...r }, null, 2));
              } else if (sub === "load") {
                if (!b || !c) die("auth load: <project> <name> --out <state.json>");
                const outFile = argv[argv.indexOf("--out") + 1];
                if (!outFile) die("auth load: missing --out <state.json>");
                const state = loadAuthState({ project: b, name: c });
                if (!state) { console.error("not found"); process.exit(2); }
                writeFileSync(outFile, JSON.stringify(state, null, 2), "utf8");
                console.log(JSON.stringify({ loaded: true, file: outFile, cookies: state.cookies.length, origins: state.origins.length }, null, 2));
              } else if (sub === "delete") {
                if (!b || !c) die("auth delete: <project> <name>");
                const ok = deleteAuthState({ project: b, name: c });
                console.log(JSON.stringify({ deleted: ok }, null, 2));
              } else {
                die("auth subcommand: list | save | load | delete");
              }
              break;
            }
            default: { die(`unknown subcommand: ${cmd}`); }
    }
  } catch (e) {
    console.error(JSON.stringify({ error: e.message, stack: e.stack?.split("\n").slice(0, 3).join("\n") }, null, 2));
    process.exit(1);
  }
})();
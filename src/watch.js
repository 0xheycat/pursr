//  pursr - watch mode.
//
// Re-runs a shoot/sweep whenever watched files change.

import { watch as fsWatch, existsSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { runShootWithSidecar } from "./shoot.js";
import { runSweep } from "./sweep.js";
import { nowIso } from "./util.js";

function normalizeGlobs(globs) {
  if (!globs) return null;
  const arr = Array.isArray(globs) ? globs : [globs];
  return arr.filter(Boolean);
}

const BC = String.fromCharCode(92);
const ESC_RX = /[.+^$X()|YZ\\]/g;
function escapeForRegex(s) {
  return s.replace(ESC_RX, function (m) {
    if (m === "X") return BC + "$";
    if (m === "Y") return BC + "{";
    if (m === "Z") return BC + "}";
    return BC + m;
  });
}

function matchGlob(path, pattern) {
  const p = String(path).split(BC).join("/");
  const pat = String(pattern);
  let re = "^";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === BC) {
      const next = pat[i + 1];
      if (next === undefined) { re += BC + BC; continue; }
      re += escapeForRegex(next);
      i++;
    } else if (c === "*") {
      if (pat[i + 1] === "*") { re += ".*"; i++; }
      else { re += "[^/]*"; }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += escapeForRegex(c);
    }
  }
  re += "$";
  return new RegExp(re).test(p);
}

function shouldFire(path, globs) {
  if (!globs || globs.length === 0) return true;
  return globs.some((g) => matchGlob(path, g));
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}

export async function startWatch(opts) {
  if (!opts.url && !opts.plan) throw new Error("startWatch: requires url or plan");
  const globs = normalizeGlobs(opts.on);
  const debounceMs = opts.debounceMs ?? 300;
  const verbose = !!opts.verbose;

  let fireCount = 0;
  let runningPromise = Promise.resolve();
  let closed = false;

  const runOne = async (event) => {
    if (closed) return;
    fireCount++;
    try {
      let capture = null;
      if (opts.plan) {
        capture = await runSweep(opts.plan, opts.outDir);
      } else {
        capture = await runShootWithSidecar({ url: opts.url, out: opts.out, flags: opts.flags || {} });
      }
      if (typeof opts.onChange === "function") {
        try { await opts.onChange({ ...event, capture }); } catch (e) {
          if (verbose) console.error("[pursr watch] onChange error:", e.message);
        }
      }
    } catch (e) {
      if (verbose) console.error("[pursr watch] capture error:", e.message);
    }
  };

  const debouncedRun = debounce((event) => { runningPromise = runningPromise.then(() => runOne(event)); }, debounceMs);

  const targets = globs && globs.length > 0
    ? globs.map((g) => {
        const lit = g.split(/[*?]/)[0];
        return resolve(lit || ".");
      })
    : [resolve(process.cwd())];

  const watchers = [];
  for (const target of targets) {
    if (!existsSync(target)) continue;
    try {
      const w = fsWatch(target, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const full = join(target, filename);
        const rel = relative(process.cwd(), full).split(BC).join("/");
        if (!shouldFire(rel, globs)) return;
        debouncedRun({ type: eventType, path: full, ts: nowIso() });
      });
      w.on("error", (e) => { if (verbose) console.error("[pursr watch] watcher error:", e.message); });
      watchers.push(w);
    } catch (e) {
      if (verbose) console.error("[pursr watch] cannot watch", target, e.message);
    }
  }

  runningPromise = runningPromise.then(() => runOne({ type: "init", path: null, ts: nowIso() }));

  return {
    close: async () => {
      closed = true;
      for (const w of watchers) { try { w.close(); } catch {} }
      await runningPromise.catch(() => {});
    },
    fires: () => fireCount,
  };
}

export { matchGlob, shouldFire };

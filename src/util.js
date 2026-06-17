// Tiny utility module: arg reading, flag parsing, output path picking,
// sidecar writing.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

export function outDir() {
  const dir = join(homedir(), "Pictures", "gen");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function makeOut(name) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(outDir(), `purr-visual-${ts}-${name}`);
}

export function nowIso() { return new Date().toISOString(); }

export function shortHash(buf) {
  return createHash("sha1").update(buf).digest("hex").slice(0, 10);
}

export function readArg(arg) {
  if (arg === undefined || arg === null) return undefined;
  if (typeof arg !== "string" || !arg.startsWith("@")) return arg;
  const path = arg.slice(1);
  if (!existsSync(path)) throw new Error(`@file not found: ${path}`);
  return readFileSync(path, "utf8").replace(/\r?\n$/, "");
}

export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    let key, val;
    if (eq >= 0) { key = a.slice(2, eq); val = a.slice(eq + 1); }
    else { key = a.slice(2); val = (i + 1 < argv.length && argv[i + 1] && !argv[i + 1].startsWith("--")) ? argv[++i] : true; }
    flags[key] = val;
  }
  return flags;
}

export function asNum(v, dflt) {
  if (v === undefined || v === null) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function asBool(v, dflt) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return dflt;
  const s = String(v).toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return dflt;
}

// Pick a positional output path from argv, skipping --flags and their values.
// Returns the path or undefined.
export function pickOutPath(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) { if (!a.includes("=")) i++; continue; }
    if (a.startsWith("@")) continue;
    if (/[\\\/]/.test(a) || a.endsWith(".png")) return a.endsWith(".png") ? a : a + ".png";
    return undefined; // first positional non-path token is not an out path
  }
  return undefined;
}

export async function writeSidecar(meta) {
  try {
    if (existsSync(meta.out)) {
      const buf = readFileSync(meta.out);
      meta.size = buf.length;
      meta.hash = shortHash(buf);
    }
  } catch {}
  const sidecar = meta.out.replace(/\.png$/i, ".json");
  writeFileSync(sidecar, JSON.stringify(meta, null, 2));
  return sidecar;
}

export function findStepPng(dir, stepName) {
  const target = String(stepName || "").replace(/\.png$/i, "");
  let files = [];
  try { files = require("node:fs").readdirSync(dir).filter(f => f.endsWith(".png")); } catch { return null; }
  // dynamic import-style fallback for ESM
  if (files.length === 0) {
    try { files = readFileSync; } catch {}
  }
  // exact basename match
  for (const f of (readdirSyncFiles(dir) || [])) {
    const base = basename(f, ".png");
    if (base === target) return join(dir, f);
  }
  for (const f of (readdirSyncFiles(dir) || [])) {
    const base = basename(f, ".png");
    if (base.endsWith("-" + target)) return join(dir, f);
  }
  for (const f of (readdirSyncFiles(dir) || [])) {
    const base = basename(f, ".png");
    if (base.includes(target)) return join(dir, f);
  }
  return null;
}

import { readdirSync } from "node:fs";
function readdirSyncFiles(dir) {
  try { return readdirSync(dir).filter(f => f.endsWith(".png")); } catch { return []; }
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function stripLarge(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "viewport" || k === "flags") continue;
    if (typeof v === "string" && v.length > 400) { out[k] = v.slice(0, 400) + "…"; continue; }
    out[k] = v;
  }
  return out;
}

export function renderSweepHtml(summary) {
  const rows = summary.steps.map(s => {
    const png = s.meta && s.meta.out ? basename(s.meta.out) : null;
    const errCell = s.ok ? "" : `<div class="err">${escapeHtml(s.error || "")}</div>`;
    const meta = s.meta ? `<pre>${escapeHtml(JSON.stringify(stripLarge(s.meta), null, 2))}</pre>` : "";
    return `<article class="step ${s.ok ? "ok" : "fail"}"><header><span class="i">#${s.i}</span><span class="name">${escapeHtml(s.name)}</span><span class="op">${escapeHtml(s.op || "")}</span><span class="ms">${s.ms}ms</span><span class="status">${s.ok ? "OK" : "FAIL"}</span></header>${png ? `<img src="${png}" loading="lazy" alt="${escapeHtml(s.name)}" />` : ""}${errCell}${meta}</article>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>purr-visual sweep — ${escapeHtml(summary.name || "")}</title>
<style>:root { color-scheme: light dark; } body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; background:#0b0b0b; color:#eee; } header.bar { padding: 12px 20px; background:#181818; border-bottom: 1px solid #2a2a2a; position: sticky; top:0; } header.bar h1 { font-size: 16px; margin: 0; } header.bar .meta { font-size: 12px; opacity: .7; } main { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; padding: 12px; } article.step { background:#161616; border:1px solid #2a2a2a; border-radius: 8px; overflow: hidden; } article.step.fail { border-color: #b04; } article.step header { display: flex; gap: 6px; padding: 8px 10px; font-size: 12px; background: #1c1c1c; align-items: center; } article.step header .i { color:#888; } article.step header .name { font-weight: 600; } article.step header .op { color:#9ad; font-family: monospace; } article.step header .ms { color:#888; margin-left: auto; } article.step header .status { padding: 1px 6px; border-radius: 4px; background:#234; color:#adf; font-size: 11px; } article.step.fail header .status { background:#421; color:#fbb; } article.step img { display: block; width: 100%; height: auto; background:#000; } article.step pre { margin: 0; padding: 8px 10px; font-size: 11px; max-height: 180px; overflow: auto; background:#111; color:#aaa; border-top: 1px solid #222; } article.step .err { padding: 8px 10px; background: #2a0e0e; color: #fbb; font-size: 12px; }</style></head>
<body><header class="bar"><h1>purr-visual sweep: ${escapeHtml(summary.name || "(unnamed)")}</h1><div class="meta">${summary.steps.length} steps &middot; ${escapeHtml(summary.outDir)} &middot; ${escapeHtml(summary.ts)}</div></header><main>${rows}</main></body></html>`;
}
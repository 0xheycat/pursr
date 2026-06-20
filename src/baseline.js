//  pursr — baseline storage for visual regression.
//
// Baselines live under $PURSR_BASELINES_DIR || ~/./baselines/<project>/
// Each baseline is keyed by a stable id derived from the URL + viewport +
// flag set (a short hash), so re-running a sweep deterministically points
// to the same baseline slot.
//
// Layout:
//   ~/.pursr/baselines/<project>/<id>/<step>.png
//   ~/.pursr/baselines/<project>/<id>/manifest.json   (url, viewport, flags, ts)
//
// Public API:
//   resolveBaselinePath({ project, id, step }) -> { dir, file, manifest? }
//   saveBaseline({ project, id, step, png, meta }) -> manifest path
//   loadBaseline({ project, id, step }) -> { png, manifest } | null
//   listBaselines(project) -> [{ id, step, ts, url }]
//   approveBaseline({ project, id, step, fromPng }) -> manifest path
//   diffKey({ url, viewport, flags }) -> string  (stable id)
//
// CLI subcommands added:  baseline save/approve/list/diff-key

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { shortHash, nowIso } from "./util.js";
import { __PURSR_GET } from "./util.js";

function baseDir(project) {
  const root = __PURSR_GET("PURSR_BASELINES_DIR") || join(homedir(), ".pursr", "baselines");
  const proj = (project || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(root, proj);
}

export function diffKey({ url = "", viewport = {}, flags = {} } = {}) {
  // Stable hash: project-agnostic, viewport+flag+url sensitive.
  const v = `${viewport.width || 0}x${viewport.height || 0}@${viewport.dpr || 1}${viewport.name ? ":" + viewport.name : ""}`;
  const fl = Object.keys(flags).sort().filter(k => k !== "out").map(k => `${k}=${flags[k]}`).join("&");
  const src = `${url}|${v}|${fl}`;
  return createHash("sha1").update(src).digest("hex").slice(0, 16);
}

export function resolveBaselinePath({ project, id, step }) {
  const dir = join(baseDir(project), id);
  const file = join(dir, `${String(step).replace(/[^a-z0-9._-]+/gi, "_")}.png`);
  const manifestPath = join(dir, "manifest.json");
  return { dir, file, manifestPath, manifest: existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null };
}

export function saveBaseline({ project, id, step, png, meta }) {
  if (!png) throw new Error("saveBaseline: missing png path");
  if (!existsSync(png)) throw new Error(`saveBaseline: png not found: ${png}`);
  const { dir, file, manifestPath } = resolveBaselinePath({ project, id, step });
  mkdirSync(dir, { recursive: true });
  // Copy file (renameSync would also work but keep semantics explicit)
  const buf = readFileSync(png);
  writeFileSync(file, buf);
  const manifest = {
    project: project || "default",
    id,
    step: String(step),
    file,
    size: buf.length,
    sha1: createHash("sha1").update(buf).digest("hex").slice(0, 16),
    url: meta?.url || null,
    viewport: meta?.viewport || null,
    flags: meta?.flags || null,
    ts: nowIso(),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, manifestPath };
}

export function loadBaseline({ project, id, step }) {
  const { file, manifest } = resolveBaselinePath({ project, id, step });
  if (!existsSync(file)) return null;
  return {
    png: file,
    size: statSync(file).size,
    hash: shortHash(readFileSync(file)),
    manifest: manifest || null,
  };
}

export function listBaselines(project) {
  const root = baseDir(project);
  if (!existsSync(root)) return [];
  const out = [];
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, "manifest.json");
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    if (!manifest) continue;
    out.push({
      id,
      step: manifest.step,
      url: manifest.url,
      ts: manifest.ts,
      sha1: manifest.sha1,
    });
  }
  return out.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
}

export function approveBaseline({ project, id, step, fromPng }) {
  if (!fromPng) throw new Error("approveBaseline: missing fromPng");
  if (!existsSync(fromPng)) throw new Error(`approveBaseline: fromPng not found: ${fromPng}`);
  const buf = readFileSync(fromPng);
  const { file, dir, manifestPath } = resolveBaselinePath({ project, id, step });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, buf);
  const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const manifest = {
    ...prev,
    project: project || prev.project || "default",
    id,
    step: String(step),
    file,
    size: buf.length,
    sha1: createHash("sha1").update(buf).digest("hex").slice(0, 16),
    ts: nowIso(),
    approvedFrom: fromPng,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

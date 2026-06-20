// pursor — MCP resources adapter.
//
// Exposes run results as MCP resources so hosts (Claude Code, Cursor, etc.)
// can browse, preview, and re-read captures without re-running captures.
//
// Resource shape (per MCP spec):
//   uri:        pursor://<kind>/<id>
//   name:       <human label>
//   description: <what it is>
//   mimeType:   image/png | application/json | text/html
//
// We track "recent" sweep outputs in-memory + persist an index at
// $PURSOR_MCP_STATE/mcp-index.json so resources survive restarts.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { nowIso } from "./util.js";

function stateDir() {
  const root = process.env.PURSOR_MCP_STATE || join(homedir(), ".pursor", "mcp");
  mkdirSync(root, { recursive: true });
  return root;
}

function indexPath() { return join(stateDir(), "mcp-index.json"); }

function loadIndex() {
  const p = indexPath();
  if (!existsSync(p)) return { resources: [] };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { resources: [] }; }
}

function saveIndex(idx) {
  writeFileSync(indexPath(), JSON.stringify(idx, null, 2), "utf8");
}

export function recordResource({ kind, id, name, description, uri, mimeType, file, meta }) {
  const idx = loadIndex();
  // De-dup by uri
  idx.resources = idx.resources.filter(r => r.uri !== uri);
  idx.resources.unshift({
    kind, id, name, description, uri, mimeType, file, meta: meta || null, ts: nowIso(),
  });
  // Cap index size
  if (idx.resources.length > 200) idx.resources = idx.resources.slice(0, 200);
  saveIndex(idx);
  return idx.resources[0];
}

export function listResources() {
  // Combine persisted index + any in-memory scan of recent sweep dirs
  const idx = loadIndex();
  // Also include sidecars sitting next to a sweep.json under cwd
  try {
    const cwd = process.cwd();
    for (const f of readdirSync(cwd)) {
      if (f === "sweep.json") {
        const sweepPath = join(cwd, f);
        try {
          const s = JSON.parse(readFileSync(sweepPath, "utf8"));
          const dirUri = `pursor://sweep/${encodeURIComponent(s.name || basename(cwd))}`;
          if (!idx.resources.some(r => r.uri === dirUri)) {
            idx.resources.push({
              kind: "sweep", id: s.name || basename(cwd),
              name: `sweep: ${s.name || basename(cwd)}`,
              description: `Sweep summary: ${(s.steps || []).length} steps`,
              uri: dirUri, mimeType: "application/json",
              file: sweepPath, meta: { steps: (s.steps || []).length, ts: s.ts }, ts: s.ts || nowIso(),
            });
          }
        } catch {}
      }
    }
  } catch {}
  return idx.resources;
}

export function readResource(uri) {
  if (typeof uri !== "string") return null;
  if (!uri.startsWith("pursor://")) return null;
  // Parse kind/id
  const rest = uri.slice("pursor://".length);
  const [kind, ...restParts] = rest.split("/");
  const id = restParts.join("/");
  const idx = loadIndex();
  const r = idx.resources.find(x => x.uri === uri);
  if (r) {
    return readResourceFile(r);
  }
  // Resolve by kind/id from filesystem fallback
  if (kind === "sweep") {
    const file = join(process.cwd(), decodeURIComponent(id), "sweep.json");
    if (existsSync(file)) {
      return { uri, mimeType: "application/json", text: readFileSync(file, "utf8") };
    }
  }
  return null;
}

function readResourceFile(r) {
  if (!r.file || !existsSync(r.file)) return { uri: r.uri, mimeType: r.mimeType, error: "file not found" };
  const data = readFileSync(r.file);
  if (r.mimeType && r.mimeType.startsWith("image/")) {
    return { uri: r.uri, mimeType: r.mimeType, blob: data.toString("base64") };
  }
  if (r.mimeType === "application/json" || r.mimeType === "text/html") {
    return { uri: r.uri, mimeType: r.mimeType, text: data.toString("utf8") };
  }
  return { uri: r.uri, mimeType: r.mimeType || "application/octet-stream", blob: data.toString("base64") };
}

//  pursr — auth state (browser storage state) management.
//
// Playwright's `storageState` is the canonical way to persist
// cookies + localStorage between browser sessions. pursr wraps it
// in a small CLI/library API so users can:
//   1. login once interactively and save the state
//   2. reuse the saved state in any subsequent capture (CI included)
//
// Storage layout:
//   ~/.pursr/auth/<project>/<name>.json
//
// Override with PURSR_$1.
//
// Public API:
//   saveAuthState({ project, name, state })    -> manifest + state file
//   loadAuthState({ project, name })           -> state object (Playwright shape)
//   listAuthStates(project)                    -> [{ name, ts, ... }]
//   deleteAuthState({ project, name })         -> bool
//
// CLI:
//    auth save <project> <name> --from <state.json>
//    auth load <project> <name> --out <state.json>
//    auth list [project]
//    auth delete <project> <name>

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { nowIso } from "./util.js";
import { __PURSR_GET } from "./util.js";

function authRoot() {
  return __PURSR_GET("PURSR_AUTH_DIR") || join(homedir(), ".pursr", "auth");
}

function authPath(project, name) {
  const root = authRoot();
  const proj = (project || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const nm = String(name || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(root, proj, `${nm}.json`);
}

export function saveAuthState({ project, name, state }) {
  if (!state) throw new Error("saveAuthState: missing state object");
  // state shape from Playwright: { cookies, origins }
  if (!Array.isArray(state.cookies)) state.cookies = [];
  if (!Array.isArray(state.origins)) state.origins = [];
  const file = authPath(project, name);
  mkdirSync(join(file, ".."), { recursive: true });
  const blob = {
    _meta: { project: project || "default", name, ts: nowIso() },
    cookies: state.cookies,
    origins: state.origins,
  };
  writeFileSync(file, JSON.stringify(blob, null, 2), "utf8");
  return { file, ...blob._meta };
}

export function loadAuthState({ project, name }) {
  const file = authPath(project, name);
  if (!existsSync(file)) return null;
  try {
    const blob = JSON.parse(readFileSync(file, "utf8"));
    return { cookies: blob.cookies || [], origins: blob.origins || [] };
  } catch {
    return null;
  }
}

export function listAuthStates(project) {
  const root = join(authRoot(), (project || "default").replace(/[^a-zA-Z0-9._-]+/g, "_"));
  if (!existsSync(root)) return [];
  const out = [];
  for (const f of readdirSync(root)) {
    if (!f.endsWith(".json")) continue;
    try {
      const blob = JSON.parse(readFileSync(join(root, f), "utf8"));
      out.push({
        name: blob?._meta?.name || f.replace(/\.json$/, ""),
        ts: blob?._meta?.ts || null,
        cookies: (blob.cookies || []).length,
        origins: (blob.origins || []).length,
      });
    } catch {}
  }
  return out.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
}

export function deleteAuthState({ project, name }) {
  const file = authPath(project, name);
  if (!existsSync(file)) return false;
  try { rmSync(file, { force: true }); return true; } catch { return false; }
}

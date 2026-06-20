//  pursr — plugin API.
//
// A plugin is a plain ES module that exports a default object with one
// or more hook handlers. The host loads plugins from:
//   1. The built-in `plugins/` directory (shipped with the package).
//   2. A path passed to `loadPlugins([...paths])`.
//   3. Any package named `pursr-plugin-*` in node_modules.
//
// Hook reference:
//
//   name:        "my-plugin"  // optional, for logs
//   viewport:    { <presetName>: { width, height, dpr, label } }
//   sweepOp:     { <opName>: async (ctx, opts) => Result }
//   beforeShoot: async (ctx) => void   // mutate ctx.flags / ctx.viewport
//   afterShoot:  async (ctx, meta) => void  // augment sidecar
//   flagHelp:    { "my-flag": "what it does" }
//
// ctx fields available to hooks:
//   url, out, viewport, flags, browser, page
//
// Example plugin (plugins/my-plugin.js):
//
//   export default {
//     name: "my-plugin",
//     viewport: {
//       "my-laptop": { width: 1440, height: 900, dpr: 2, label: "MBP 14" },
//     },
//     sweepOp: {
//       "lighthouse": async (ctx, opts) => {
//         // ... run lighthouse, return { out, meta }
//       },
//     },
//     beforeShoot: async (ctx) => {
//       // e.g. set extra cookies, click a button, etc.
//     },
//   };

const plugins = [];
const registeredRefs = new Set();
const sweepOps = new Map();
const viewportPresets = new Map();
const flagHelp = new Map();

export function registerPlugin(p) {
  if (!p || typeof p !== "object") return;
  if (registeredRefs.has(p)) return;
  registeredRefs.add(p);
  plugins.push(p);
  if (p.name) console.error(`[pursr] loaded plugin: ${p.name}`);
  if (p.viewport) {
    for (const [k, v] of Object.entries(p.viewport)) viewportPresets.set(k, v);
  }
  if (p.sweepOp) {
    for (const [k, v] of Object.entries(p.sweepOp)) sweepOps.set(k, v);
  }
  if (p.flagHelp) {
    for (const [k, v] of Object.entries(p.flagHelp)) flagHelp.set(k, v);
  }
}

export async function loadPlugins(paths = []) {
  if (typeof paths === "string") paths = [paths];
  const loadedPaths = new Set();
  // auto-load built-in plugins from plugins/ directory
  const { readdirSync, existsSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const pluginDir = join(selfDir, "..", "plugins");
  if (existsSync(pluginDir)) {
    for (const f of readdirSync(pluginDir)) {
      if (f.endsWith(".js")) {
        const fullPath = pathToFileURL(join(pluginDir, f)).href;
        if (loadedPaths.has(fullPath)) continue;
        loadedPaths.add(fullPath);
        try {
          const mod = await import(/* @vite-ignore */ fullPath);
          registerPlugin(mod.default || mod);
        } catch (e) {
          console.error(`[pursr] failed to load built-in plugin ${f}: ${e.message}`);
        }
      }
    }
  }
  // user-supplied plugins — resolve relative to cwd
  for (const p of paths) {
    if (loadedPaths.has(p)) continue;
    loadedPaths.add(p);
    try {
      const resolved = pathToFileURL(join(process.cwd(), p)).href;
      const mod = await import(/* @vite-ignore */ resolved);
      registerPlugin(mod.default || mod);
    } catch (e) {
      console.error(`[pursr] failed to load plugin ${p}: ${e.message}`);
    }
  }
  return plugins.length;
}

export function listPlugins() { return plugins.map(p => p?.name || "(unnamed)"); }

export function getSweepOp(name) { return sweepOps.get(name); }
export function getViewportPreset(name) { return viewportPresets.get(name); }
export function listViewportPresets() { return Object.fromEntries(viewportPresets); }
export function getFlagHelp() { return Object.fromEntries(flagHelp); }

export async function runBeforeShoot(ctx) {
  for (const p of plugins) {
    if (typeof p.beforeShoot === "function") {
      try { await p.beforeShoot(ctx); } catch (e) { console.error(`[plugin ${p.name}] beforeShoot: ${e.message}`); }
    }
  }
}

export async function runAfterShoot(ctx, meta) {
  for (const p of plugins) {
    if (typeof p.afterShoot === "function") {
      try { await p.afterShoot(ctx, meta); } catch (e) { console.error(`[plugin ${p.name}] afterShoot: ${e.message}`); }
    }
  }
}
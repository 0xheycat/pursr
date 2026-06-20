// Browser launcher: auto-detect Playwright + system Chrome.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let _chromium = null;
async function getChromium() {
  if (_chromium) return _chromium;
  // Try local node_modules first
  try { return _chromium = (await import("playwright-core")).chromium; } catch {}
  // Try Codex cua_node runtime (current Codex Desktop bundles it).
  // The cua_node folder has a hash subdir (e.g. 789504f803e82e2b), so we
  // walk it to find the playwright-core entry.
  const cuaRoot = join(homedir(), "AppData", "Local", "OpenAI", "Codex", "runtimes", "cua_node");
  if (existsSync(cuaRoot)) {
    const { readdirSync } = await import("node:fs");
    const subdirs = (() => { try { return readdirSync(cuaRoot); } catch { return []; } })();
    for (const sub of subdirs) {
      const cand = join(cuaRoot, sub, "bin", "node_modules", "playwright-core", "index.mjs");
      if (existsSync(cand)) {
        try {
          const url = "file:///" + cand.replace(/\\/g, "/");
          return _chromium = (await import(url)).chromium;
        } catch {}
      }
    }
  }
  throw new Error("playwright-core not found. Install it: npm i -D playwright-core");
}

const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
function findChrome() {
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  return null;
}

const BROWSER_ARGS = Object.freeze(["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]);

export async function launch() {
  const chromium = await getChromium();
  const exec = findChrome();
  if (!exec) throw new Error("system Chrome not found in standard paths");
  return await chromium.launch({ headless: true, executablePath: exec, args: BROWSER_ARGS });
}

export async function newPage(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr || 1,
    reducedMotion: "no-preference",
    colorScheme: "light",
    hasTouch: !!(viewport.name && viewport.name.startsWith("mobile")),
    isMobile: !!(viewport.name && viewport.name.startsWith("mobile")),
    storageState: opts.storageState || undefined,
  });
  const page = await ctx.newPage();
  page._pursorContext = ctx;
  return page;
}
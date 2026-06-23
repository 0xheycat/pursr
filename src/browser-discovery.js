import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

function uniq(list) {
  return [...new Set(list.filter(Boolean).map(String))];
}

function envPath(env, key) {
  return env && env[key] ? String(env[key]) : "";
}

function pathJoin(platform, ...parts) {
  return platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

function joinIf(platform, base, ...parts) {
  return base ? pathJoin(platform, base, ...parts) : "";
}

function pathExecutableCandidates(env, names, platform) {
  const pathValue = envPath(env, "PATH");
  if (!pathValue) return [];
  const dirs = pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean);
  const exts = platform === "win32"
    ? (envPath(env, "PATHEXT") || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];
  const out = [];
  for (const dir of dirs) {
    for (const name of names) {
      if (platform === "win32" && /\.[a-z0-9]+$/i.test(name)) out.push(pathJoin(platform, dir, name));
      else for (const ext of exts) out.push(pathJoin(platform, dir, name + ext.toLowerCase()));
    }
  }
  return out;
}

export function browserCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.homeDir || homedir();
  const localAppData = envPath(env, "LOCALAPPDATA");
  const programFiles = envPath(env, "ProgramFiles") || "C:\\Program Files";
  const programFilesX86 = envPath(env, "ProgramFiles(x86)") || "C:\\Program Files (x86)";

  const explicit = [
    envPath(env, "PURSR_BROWSER_PATH"),
    envPath(env, "CHROME_PATH"),
    envPath(env, "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
  ];

  if (platform === "win32") {
    const pathNames = [
      "chrome.exe", "msedge.exe", "brave.exe", "chromium.exe",
    ];
    return uniq([
      ...explicit,
      pathJoin(platform, programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      pathJoin(platform, programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      joinIf(platform, localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      pathJoin(platform, programFiles, "Google", "Chrome Beta", "Application", "chrome.exe"),
      pathJoin(platform, programFilesX86, "Google", "Chrome Beta", "Application", "chrome.exe"),
      joinIf(platform, localAppData, "Google", "Chrome Beta", "Application", "chrome.exe"),
      pathJoin(platform, programFiles, "Google", "Chrome Dev", "Application", "chrome.exe"),
      pathJoin(platform, programFilesX86, "Google", "Chrome Dev", "Application", "chrome.exe"),
      joinIf(platform, localAppData, "Google", "Chrome Dev", "Application", "chrome.exe"),
      joinIf(platform, localAppData, "Google", "Chrome SxS", "Application", "chrome.exe"),
      pathJoin(platform, programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      pathJoin(platform, programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      joinIf(platform, localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      pathJoin(platform, programFiles, "Microsoft", "Edge Beta", "Application", "msedge.exe"),
      pathJoin(platform, programFilesX86, "Microsoft", "Edge Beta", "Application", "msedge.exe"),
      joinIf(platform, localAppData, "Microsoft", "Edge Beta", "Application", "msedge.exe"),
      pathJoin(platform, programFiles, "Microsoft", "Edge Dev", "Application", "msedge.exe"),
      pathJoin(platform, programFilesX86, "Microsoft", "Edge Dev", "Application", "msedge.exe"),
      joinIf(platform, localAppData, "Microsoft", "Edge Dev", "Application", "msedge.exe"),
      pathJoin(platform, programFiles, "Microsoft", "Edge SxS", "Application", "msedge.exe"),
      pathJoin(platform, programFilesX86, "Microsoft", "Edge SxS", "Application", "msedge.exe"),
      joinIf(platform, localAppData, "Microsoft", "Edge SxS", "Application", "msedge.exe"),
      pathJoin(platform, programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      pathJoin(platform, programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      joinIf(platform, localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      pathJoin(platform, programFiles, "BraveSoftware", "Brave-Browser-Beta", "Application", "brave.exe"),
      pathJoin(platform, programFilesX86, "BraveSoftware", "Brave-Browser-Beta", "Application", "brave.exe"),
      joinIf(platform, localAppData, "BraveSoftware", "Brave-Browser-Beta", "Application", "brave.exe"),
      pathJoin(platform, programFiles, "BraveSoftware", "Brave-Browser-Nightly", "Application", "brave.exe"),
      pathJoin(platform, programFilesX86, "BraveSoftware", "Brave-Browser-Nightly", "Application", "brave.exe"),
      joinIf(platform, localAppData, "BraveSoftware", "Brave-Browser-Nightly", "Application", "brave.exe"),
      pathJoin(platform, programFiles, "Chromium", "Application", "chrome.exe"),
      pathJoin(platform, programFilesX86, "Chromium", "Application", "chrome.exe"),
      ...pathExecutableCandidates(env, pathNames, platform),
    ]);
  }

  if (platform === "darwin") {
    return uniq([
      ...explicit,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      pathJoin(platform, home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      pathJoin(platform, home, "Applications", "Google Chrome Beta.app", "Contents", "MacOS", "Google Chrome Beta"),
      "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
      pathJoin(platform, home, "Applications", "Google Chrome Dev.app", "Contents", "MacOS", "Google Chrome Dev"),
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      pathJoin(platform, home, "Applications", "Google Chrome Canary.app", "Contents", "MacOS", "Google Chrome Canary"),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
      "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
      "/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Brave Browser Beta.app/Contents/MacOS/Brave Browser Beta",
      "/Applications/Brave Browser Nightly.app/Contents/MacOS/Brave Browser Nightly",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ...pathExecutableCandidates(env, [
        "google-chrome", "google-chrome-stable", "google-chrome-beta", "google-chrome-unstable",
        "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-beta",
        "microsoft-edge-dev", "brave-browser", "brave-browser-beta", "brave-browser-nightly",
      ], platform),
    ]);
  }

  return uniq([
    ...explicit,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome-beta",
    "/usr/bin/google-chrome-unstable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge-beta",
    "/usr/bin/microsoft-edge-dev",
    "/usr/bin/brave-browser",
    "/usr/bin/brave-browser-beta",
    "/usr/bin/brave-browser-nightly",
    "/snap/bin/chromium",
    "/snap/bin/brave",
    ...pathExecutableCandidates(env, [
      "google-chrome", "google-chrome-stable", "google-chrome-beta", "google-chrome-unstable",
      "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable",
      "microsoft-edge-beta", "microsoft-edge-dev", "brave-browser", "brave-browser-beta",
      "brave-browser-nightly",
    ], platform),
  ]);
}

export function discoverBrowsers(options = {}) {
  const exists = options.exists || existsSync;
  const candidates = browserCandidates(options);
  const found = candidates.filter((path) => {
    try { return exists(path); } catch { return false; }
  });
  return {
    found,
    preferred: found[0] || null,
    candidates,
    env: {
      PURSR_BROWSER_PATH: !!(options.env || process.env).PURSR_BROWSER_PATH,
      CHROME_PATH: !!(options.env || process.env).CHROME_PATH,
    },
  };
}

export function findBrowserExecutable(options = {}) {
  return discoverBrowsers(options).preferred;
}

export function browserSetupHints(platform = process.platform) {
  const common = [
    "Set PURSR_BROWSER_PATH to a Chrome-compatible executable if auto-detection misses it.",
    "Install playwright-core in the project when using pursr as a local dependency: npm i -D playwright-core",
  ];
  if (platform === "win32") {
    return [
      "Install Google Chrome, Microsoft Edge, Brave, or Chromium.",
      "Dev/Beta/Canary channels and PATH-installed browser executables are also detected when available.",
      "Windows example: setx PURSR_BROWSER_PATH \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\"",
      ...common,
    ];
  }
  if (platform === "darwin") {
    return [
      "Install Google Chrome, Microsoft Edge, Brave, or Chromium.",
      "Dev/Beta/Canary channels, user Applications, and PATH-installed browser executables are also detected when available.",
      "macOS example: export PURSR_BROWSER_PATH=\"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\"",
      ...common,
    ];
  }
  return [
    "Install google-chrome-stable, chromium, microsoft-edge-stable, or brave-browser.",
    "Dev/Beta/unstable channels and PATH-installed browser executables are also detected when available.",
    "Linux example: export PURSR_BROWSER_PATH=/usr/bin/google-chrome",
    ...common,
  ];
}

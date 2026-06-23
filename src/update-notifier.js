import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { request as httpsRequest } from "node:https";

const DAY_MS = 24 * 60 * 60 * 1000;

export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function updateCachePath(env = process.env) {
  const root = env.PURSR_HOME || join(homedir(), ".pursr");
  return join(root, "update-check.json");
}

export function shouldCheckForUpdate({ env = process.env, stdout = process.stdout, stderr = process.stderr, now = Date.now(), cachePath = updateCachePath(env) } = {}) {
  if (env.PURSR_NO_UPDATE_NOTIFIER || env.NO_UPDATE_NOTIFIER || env.CI) return false;
  if (!stderr?.isTTY || !stdout?.isTTY) return false;
  try {
    if (!existsSync(cachePath)) return true;
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    return !cached.checkedAt || now - Date.parse(cached.checkedAt) > DAY_MS;
  } catch {
    return true;
  }
}

function fetchLatestVersion({ registryUrl = "https://registry.npmjs.org/pursr/latest", timeoutMs = 800 } = {}) {
  return new Promise((resolve) => {
    const req = httpsRequest(registryUrl, { method: "GET", timeout: timeoutMs, headers: { accept: "application/json" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json.version || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.end();
  });
}

export async function checkForUpdate({ currentVersion, env = process.env, stdout = process.stdout, stderr = process.stderr, now = Date.now(), cachePath = updateCachePath(env), fetchLatest = fetchLatestVersion } = {}) {
  if (!shouldCheckForUpdate({ env, stdout, stderr, now, cachePath })) return null;
  const latest = await fetchLatest();
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ checkedAt: new Date(now).toISOString(), latest }, null, 2), "utf8");
  } catch {}
  if (!latest || compareVersions(latest, currentVersion) <= 0) return null;
  return { current: currentVersion, latest, command: "npm i -g pursr@latest" };
}

export async function notifyUpdate(options = {}) {
  const result = await checkForUpdate(options);
  if (!result) return null;
  options.stderr?.write?.(`\npursr update available: ${result.current} -> ${result.latest}\nRun: ${result.command}\n\n`);
  return result;
}

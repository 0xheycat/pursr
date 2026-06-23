import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { browserSetupHints, discoverBrowsers } from "./browser-discovery.js";
import { resolvePlaywrightCore } from "./runway.js";

function nodeMajor(version = process.version) {
  const m = String(version).match(/^v?(\d+)/);
  return m ? Number(m[1]) : 0;
}

function okCheck(name, ok, details = {}) {
  return { name, ok: !!ok, ...details };
}

export async function runDoctor(options = {}) {
  const version = options.version || process.version;
  const browsers = discoverBrowsers(options);
  let playwright = null;
  try {
    const resolved = await resolvePlaywrightCore();
    playwright = okCheck("playwright-core", true, { source: resolved.source });
  } catch (e) {
    playwright = okCheck("playwright-core", false, { error: e.message });
  }

  const packageRoot = options.packageRoot || dirname(dirname(fileURLToPath(import.meta.url)));
  const skillPath = join(packageRoot, "SKILL.md");
  const checks = [
    okCheck("node", nodeMajor(version) >= 18, { version, required: ">=18" }),
    playwright,
    okCheck("browser", !!browsers.preferred, { preferred: browsers.preferred, found: browsers.found }),
    okCheck("skill", existsSync(skillPath), { path: skillPath }),
  ];

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    checks,
    browsers,
    hints: ok ? [] : browserSetupHints(options.platform || process.platform),
  };
}

export function renderDoctorText(result) {
  const lines = [];
  lines.push(result.ok ? "pursr doctor: OK" : "pursr doctor: attention needed");
  for (const check of result.checks) {
    const mark = check.ok ? "ok" : "missing";
    let detail = "";
    if (check.name === "browser") detail = check.preferred ? ` (${check.preferred})` : "";
    if (check.name === "playwright-core") detail = check.source ? ` (${check.source})` : check.error ? ` (${check.error})` : "";
    if (check.name === "node") detail = ` (${check.version}, required ${check.required})`;
    lines.push(`- ${mark}: ${check.name}${detail}`);
  }
  if (result.hints.length) {
    lines.push("");
    lines.push("Next steps:");
    for (const hint of result.hints) lines.push(`- ${hint}`);
  }
  return lines.join("\n");
}

export async function runSetup(options = {}) {
  const doctor = await runDoctor(options);
  return {
    ok: doctor.ok,
    doctor,
    recommended: doctor.ok ? [
      "Run: pursr probe https://example.com",
      "For agents, point them at node_modules/pursr/SKILL.md or enable the pursr MCP server.",
    ] : [
      ...doctor.hints,
      "After fixing dependencies, run: pursr doctor",
    ],
  };
}

export function renderSetupText(result) {
  const lines = [];
  lines.push(result.ok ? "pursr setup: ready" : "pursr setup: manual steps required");
  lines.push("");
  lines.push(renderDoctorText(result.doctor));
  lines.push("");
  lines.push("Recommended:");
  for (const item of result.recommended) lines.push(`- ${item}`);
  return lines.join("\n");
}

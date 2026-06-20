//  pursr — axe-core accessibility audit.
//
// Injects axe-core into the page, runs a WCAG audit, returns violations.
// Optionally highlights violated elements with a red overlay and
// generates a full audit report.
//
// Used internally via runAudit() and also exposed as a sweep-op
// so it works in batch plans.
//
// Dependencies: axe-core (npm i axe-core)

import { launch, newPage } from "./runway.js";
import { createRequire } from "node:module";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { asNum, nowIso } from "./util.js";

// ─── Injected audit runner ──────────────────────────────────────────────

const AUDIT_RUNNER = (axeSource) => `
${axeSource}
(function() {
  return new Promise((resolve, reject) => {
    const config = typeof window.__PURR_AUDIT_CONFIG__ !== 'undefined' ? window.__PURR_AUDIT_CONFIG__ : {};
    var tags = config.tags || ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
    axe.run(
      { runOnly: { type: 'tag', values: tags } },
      function(err, results) {
        if (err) { reject(err.message); return; }
        // Also collect element references for highlighting
        resolve(JSON.parse(JSON.stringify(results)));
      }
    );
  });
})()
`;

// ─── Highlight overlay script ──────────────────────────────────────────

const HIGHLIGHT_VIOLATIONS = (violationsJson) => `
(function() {
  var violations = ${violationsJson};
  if (!violations || !violations.length) return;
  var style = document.createElement('style');
  style.id = '__purr_audit_highlight__';
  style.textContent = \`
    [data-purr-audit-violation] {
      outline: 3px solid rgba(255, 0, 0, 0.85) !important;
      background: rgba(255, 0, 0, 0.12) !important;
      position: relative !important;
    }
    [data-purr-audit-violation]::after {
      content: attr(data-purr-audit-violation);
      position: absolute;
      top: -20px;
      left: 0;
      background: #d00;
      color: #fff;
      font: 10px/14px monospace;
      padding: 1px 5px;
      border-radius: 3px;
      z-index: 999999;
      white-space: nowrap;
    }
  \`;
  document.documentElement.appendChild(style);
  for (var v of violations) {
    for (var n of v.nodes || []) {
      for (var t of n.target || []) {
        try {
          var sel = Array.isArray(t) ? t.join(' ') : t;
          var els = document.querySelectorAll(sel);
          for (var e of els) {
            e.setAttribute('data-purr-audit-violation', v.id + ': ' + v.impact);
          }
        } catch(e) {}
      }
    }
  }
})()
`;

// ─── Load axe-core ──────────────────────────────────────────────────────

let _axeSource = null;
async function getAxeSource() {
  if (_axeSource) return _axeSource;
  // Try node_modules/axe-core
  // Primary: use createRequire to resolve axe-core from this module (works for the
  // pursr package itself, the linked repo, or any project that has axe-core installed).
  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve("axe-core");
    const dir = resolved.replace(/[\\\/][^\\\/]+$/, "");
    for (const fname of ["axe.min.js", "axe.js"]) {
      const p = dir + "/" + fname;
      if (existsSync(p)) { _axeSource = readFileSync(p, "utf8"); return _axeSource; }
    }
  } catch { /* fall through to path-based lookup */ }
  const paths = [
    join(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
    join(process.cwd(), "node_modules", "axe-core", "axe.js"),
    new URL("..", import.meta.url).pathname && join(dirname(new URL(import.meta.url).pathname), "node_modules", "axe-core", "axe.min.js"),
    join(dirname(process.execPath), "node_modules", "axe-core", "axe.min.js"),
    // Global npm install (Windows: %APPDATA%\npm\node_modules, Unix: /usr/lib/node_modules)
    join(process.env.APPDATA || "", "npm", "node_modules", "axe-core", "axe.min.js"),
    join(process.env.HOME || "", ".npm-global", "lib", "node_modules", "axe-core", "axe.min.js"),
    join("/usr", "lib", "node_modules", "axe-core", "axe.min.js"),
    join("/usr", "local", "lib", "node_modules", "axe-core", "axe.min.js"),
    // The pursr package's own node_modules (when running from local repo or via node bin)
    join(dirname(new URL(import.meta.url).pathname), "..", "node_modules", "axe-core", "axe.min.js"),
  ];
  for (const p of paths) {
    if (p && existsSync(p)) {
      _axeSource = readFileSync(p, "utf8");
      return _axeSource;
    }
  }
throw new Error("axe-core not found. Install: npm i axe-core");}

// ─── Group helper ───────────────────────────────────────────────────────

/** Count violations by WCAG impact level */
function summarizeViolations(violations) {
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byTag = {};
  for (const v of violations) {
    byImpact[v.impact] = (byImpact[v.impact] || 0) + v.nodes.length;
    for (const t of v.tags || []) {
      if (!byTag[t]) byTag[t] = 0;
      byTag[t] += v.nodes.length;
    }
  }
  return { total: violations.length, totalNodes: violations.reduce((s, v) => s + v.nodes.length, 0), byImpact, byTag };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Run axe-core audit on a URL.
 *
 * @param {object} opts
 * @param {string} opts.url        - Target URL
 * @param {string[]} [opts.tags]   - WCAG tags (default: wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice)
 * @param {string}  [opts.outDir]  - Output directory
 * @param {boolean} [opts.screenshot=true] - Capture highlighted screenshot
 * @param {object}  [opts.flags]   - Extra capture flags
 * @returns {Promise<object>} Audit result
 */
export async function runAudit({ url, tags, outDir, screenshot = true, flags = {} }) {
  const dir = outDir || join(process.cwd(), `audit-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  const viewport = resolveViewport(flags);
  const browser = await launch();
  const axeSource = await getAxeSource();

  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url);
    await settle(page);
    // Give dynamic content time to fully render
    await page.waitForTimeout(800);

    // Inject axe config
    await page.evaluate((t) => {
      window.__PURR_AUDIT_CONFIG__ = { tags: t || ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] };
    }, tags || undefined);

    // Inject and run axe
    const rawResults = await page.evaluate(AUDIT_RUNNER, axeSource);

    const result = {
      url,
      title: r.title,
      ts: nowIso(),
      viewport: { width: viewport.width, height: viewport.height, dpr: viewport.dpr },
      violationSummary: summarizeViolations(rawResults.violations || []),
      passes: (rawResults.passes || []).length,
      incomplete: (rawResults.incomplete || []).length,
      inapplicable: (rawResults.inapplicable || []).length,
      violations: rawResults.violations || [],
    };

    // Write audit report
    const auditPath = join(dir, "audit.json");
    writeFileSync(auditPath, JSON.stringify(result, null, 2));

    // Write summary Markdown
    const mdPath = join(dir, "audit-summary.md");
    writeFileSync(mdPath, renderAuditMarkdown(result));

    // Highlighted screenshot
    if (screenshot && result.violations.length > 0) {
      const violationsJson = JSON.stringify(result.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        nodes: (v.nodes || []).map(n => ({ target: n.target })),
      })));
      await page.evaluate(HIGHLIGHT_VIOLATIONS, violationsJson);
      await page.waitForTimeout(200);
      const shotPath = join(dir, "audit-highlighted.png");
      await page.screenshot({ path: shotPath, fullPage: true });
      result.highlightedScreenshot = shotPath;
    } else if (screenshot) {
      const shotPath = join(dir, "audit-clean.png");
      await page.screenshot({ path: shotPath, fullPage: true });
      result.cleanScreenshot = shotPath;
    }

    return result;
  } finally {
    try { await browser.close(); } catch {}
  }
}

// ─── Markdown report ────────────────────────────────────────────────────

function renderAuditMarkdown(result) {
  const s = result.violationSummary || {};
  const lines = [
    `# Accessibility Audit: ${result.url}`,
    ``,
    `**Date:** ${result.ts}`,
    `**Viewport:** ${result.viewport.width}x${result.viewport.height} @${result.viewport.dpr}x`,
    ``,
    `## Summary`,
    ``,
    `| Severity | Count |`,
    `|----------|-------|`,
    `| 🔴 Critical | ${s.byImpact?.critical || 0} nodes`,
    `| 🟠 Serious | ${s.byImpact?.serious || 0} nodes`,
    `| 🟡 Moderate | ${s.byImpact?.moderate || 0} nodes`,
    `| ⚪ Minor | ${s.byImpact?.minor || 0} nodes`,
    `| **Total violations** | **${s.total} rules, ${s.totalNodes} nodes** |`,
    ``,
    `| Check | Count |`,
    `|-------|-------|`,
    `| Passes | ${result.passes || 0} |`,
    `| Incomplete | ${result.incomplete || 0} |`,
    `| Inapplicable | ${result.inapplicable || 0} |`,
    ``,
  ];

  if (result.violations.length) {
    lines.push(`## Violations`);
    lines.push(``);
    for (const v of result.violations) {
      lines.push(`### ${v.id} — ${v.impact}`);
      lines.push(``);
      lines.push(`**Help:** ${v.helpUrl || v.help || 'N/A'}`);
      lines.push(``);
      lines.push(`**Tags:** ${(v.tags || []).join(', ')}`);
      lines.push(``);
      lines.push(`**Affected nodes:** ${(v.nodes || []).length}`);
      lines.push(``);
      for (const n of (v.nodes || []).slice(0, 10)) { // top 10 per violation
        const target = (n.target || []).join(', ');
        const snippet = (n.html || '').slice(0, 200);
        const failureSummary = n.failureSummary || '';
        lines.push(`- \`${target}\``);
        if (snippet) lines.push(`  - \`${snippet.replace(/`/g, '')}\``);
        if (failureSummary) lines.push(`  - ${failureSummary.split('\\n')[0]}`);
      }
      if ((v.nodes || []).length > 10) lines.push(`  - … and ${v.nodes.length - 10} more nodes`);
      lines.push(``);
    }
  }

  if (result.highlightedScreenshot) lines.push(`![Highlighted screenshot](${result.highlightedScreenshot})`);
  if (result.cleanScreenshot) lines.push(`![Clean screenshot](${result.cleanScreenshot})`);

  lines.push(``);
  lines.push(`_Generated by pursr audit_`);
  return lines.join('\n');
}

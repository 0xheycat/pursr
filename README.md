# pursor

> **Visual QA & audit CLI + library + MCP server for the browser.**
> Capture, diff, sweep, and audit any web target — with multi-viewport,
> layered states, hover, grid overlays, animation freeze, camera control,
> axe-core accessibility audit, CI output, and auto-healing selectors.

```bash
npx pursor probe https://example.com
npx pursor shoot https://example.com --preset mobile-375 --grid
npx pursor sweep ./plan.json
npx pursor audit https://example.com --tags wcag2a,wcag2aa
npx pursor-mcp   # MCP stdio server for Claude Code / Cursor
```

## Install

```bash
npm install pursor
npm install --save-dev playwright-core   # peer dep — bring your own Chrome
```

`pursor` does **not** bundle Chromium. It drives your system Chrome via
Playwright. No extra browser downloads.

---

## Table of Contents

- [CLI](#cli)
- [MCP Server](#mcp-server)
- [Accessibility Audit](#accessibility-audit)
- [DOM Snapshot](#dom-snapshot)
- [CI Output](#ci-output)
- [Auto-heal Selectors](#auto-heal-selectors)
- [Sweep Plans](#sweep-plans)
- [Plugin API](#plugin-api)
- [Library API](#library-api)
- [Development](#development)

---

## CLI

```bash
# Health check
pursor probe https://example.com

# Screenshot (simple)
pursor shot https://example.com ./out/shot.png

# Rich capture: viewport preset + cursor + grid
pursor shoot https://example.com \
  --preset desktop-1280 \
  --cursor crosshair \
  --grid --grid-tile 64

# Isolate a layer (entity / terrain / hud / ui)
pursor layer https://example.com entity

# Animation timeline: 8 frames at 200ms
pursor frames https://example.com 8 200 ./frames/

# Hover an element
pursor hover https://example.com "text=Login"

# Pixel diff vs a reference screenshot
pursor diff https://example.com ./ref.png ./out/diff.png

# Batched plan (see plans/ for examples)
pursor sweep ./plan.json

# Accessibility audit (requires: npm i axe-core)
pursor audit https://example.com --tags wcag2a,wcag2aa

# DOM + selector map snapshot
pursor dom https://example.com
```

### Subcommands

| Subcommand | Purpose |
|---|---|
| `probe` | Health check (HTTP status, page title) |
| `shot` / `full` | Viewport / full-page screenshot |
| `eval` | Execute JS in the page, return result |
| `click` / `type` / `wait` / `seq` | Interaction primitives |
| `diff` | Pixel-level diff vs a reference PNG |
| `viewports` | List all registered viewport presets |
| `shoot` | Rich capture (overlays, freeze, camera, plugins) |
| `layer` | Capture one isolated layer (entity/hud/ui/terrain) |
| `frames` | N-frame animation timeline at interval |
| `hover` | Hover state capture |
| `sweep` | Batched capture plan → HTML report + CI output |
| `audit` | ⭐ axe-core WCAG accessibility audit + highlighted screenshot |
| `dom` / `dom-snapshot` | ⭐ Serialized DOM + CSS selectors + XPath + bounding rects |

---

## MCP Server

`pursor-mcp` exposes every capability as MCP tools over stdio —
works with Claude Code, Cursor, Continue, and any MCP host.

```bash
npx pursor-mcp
# or with verbose logging:
npx pursor-mcp --verbose
```

### Exposed Tools

| Tool | Description |
|---|---|
| `pursor_shoot` | Full screenshot with viewport, grid, layer, cursor, camera, freeze |
| `pursor_diff` | Pixel diff vs reference PNG + diff overlay |
| `pursor_sweep` | Execute a batch plan JSON → summary |
| `pursor_frames` | Animation frame timeline |
| `pursor_probe` | Health-check a URL |
| `pursor_audit` | axe-core accessibility audit |
| `pursor_dom_snapshot` | DOM + CSSOM + selector map + bounding rects |

### Config

Config via `PURSOR_MCP_CONFIG` env var (inline JSON or file path)
or `~/.pursor/mcp-config.json`:

```json
{
  "plugins": ["./my-plugin.js"],
  "defaultOutDir": "./mcp-output",
  "verbose": true
}
```

### MCP Host Examples

**Claude Code:**
```json
{
  "mcpServers": {
    "pursor": {
      "command": "npx",
      "args": ["pursor-mcp"]
    }
  }
}
```

**Cursor:**
```json
{
  "mcpServers": {
    "pursor": {
      "command": "npx",
      "args": ["pursor-mcp", "--verbose"]
    }
  }
}
```

---

## Accessibility Audit

Run axe-core WCAG audits on any URL. Optionally captures a highlighted
screenshot with violated elements outlined in red.

```bash
# Quick audit with default tags (wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice)
pursor audit https://example.com

# Specific WCAG tags
pursor audit https://example.com --tags wcag2a,wcag2aa

# Custom output directory
pursor audit https://example.com ./audit-report/
```

**Output:**
- `audit.json` — full axe-core results with violation summary
- `audit-summary.md` — readable Markdown report with severity breakdown
- `audit-highlighted.png` — screenshot with violations visibly marked

**Sweep plan usage:**
```json
{
  "name": "accessibility-check",
  "base": "https://example.com",
  "steps": [
    {
      "name": "wcag-audit",
      "audit": {
        "tags": "wcag2a,wcag2aa,wcag21aa",
        "screenshot": true
      }
    }
  ]
}
```

---

## DOM Snapshot

Every capture can optionally produce a `.dom.json` sidecar with complete
page structure — useful for debugging visual regression without opening
a browser.

```bash
pursor dom https://example.com
```

**Captured data:**
- `dom` — `document.documentElement.outerHTML`
- `selectorMap[]` — every visible element with:
  - `tag`, `id`, `css` (CSS selector), `xpath`
  - `role`, `ariaLabel`, `ariaRole`, `text`, `placeholder`, `alt`, `href`, `src`
  - `rect` — viewport-relative bounding box `{x, y, w, h}`
  - `visible` — visibility flag
- `styles` — computed stylesheet rules keyed by selector
- `viewport` — current viewport dimensions + DPR

**Programmatic:**
```js
import { captureDomSnapshot } from "pursor";

const snapshot = await captureDomSnapshot({
  url: "https://example.com",
  out: "./snapshot.dom.json",
});
console.log(snapshot.selectorMap.length, "elements found");
```

---

## CI Output

Sweep plans automatically generate CI-compatible output files alongside
the HTML report — no extra config needed.

```bash
pursor sweep ./plan.json
# Produces in the output directory:
#   sweep.json       — raw summary
#   index.html       — visual HTML dashboard
#   sweep.junit.xml  — JUnit XML (GitLab CI, Jenkins, CircleCI)
#   sweep.github.json — GitHub Actions annotations format
#   sweep.md         — Markdown summary
```

### GitHub Actions integration

```yaml
- name: Visual QA
  run: npx pursor@latest sweep ./plan.json
- name: Annotate
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const { annotations } = JSON.parse(fs.readFileSync('sweep-output/sweep.github.json'));
      annotations.forEach(a => core.error(a.message, {file: a.filename, title: a.title}));
```

### JUnit in GitLab CI

```yaml
visual-qa:
  script: npx pursor@latest sweep ./plan.json
  artifacts:
    reports:
      junit: sweep-output/sweep.junit.xml
```

---

## Auto-heal Selectors

In sweep plans, selectors can be an array of fallback strategies.
pursor tries each one in order until a visible element is found:

```json
{
  "name": "login-flow",
  "base": "https://example.com",
  "steps": [
    {
      "name": "click-login",
      "hover": {
        "selector": [
          "text=Login",
          "button[type=submit]",
          "#login-btn",
          "a[href*='login']"
        ]
      }
    }
  ]
}
```

**Supported selector types:**
- `text=Login` — Playwright text locator (substring, or `text==Login` for exact)
- `text~regex` — regex text match
- `role=button|Submit` — ARIA role with accessible name
- `aria=label` — accessibility label
- `placeholder=Email` — placeholder text
- CSS selectors — any valid CSS selector as fallback

---

## Sweep Plans

Batch capture plans in JSON. Each step runs one operation.

```json
{
  "name": "checkout-flow",
  "base": "https://example.com",
  "outDir": "./sweep-checkout",
  "steps": [
    { "name": "homepage",   "shoot": { "preset": "desktop-1280", "cursor": "default" } },
    { "name": "mobile-view","shoot": { "preset": "mobile-375", "grid": true } },
    { "name": "nav-hover",  "hover": { "selector": "text=Products", "settleMs": 400 } },
    { "name": "add-to-cart","frames": { "count": 6, "intervalMs": 200 } },
    { "name": "diff",       "diff":  { "ref": "baseline" } }
  ]
}
```

**Step operations:** `shoot`, `hover`, `frames`, `diff`, `audit`, or any
registered plugin sweep-op.

---

## Plugin API

Extend `pursor` with custom viewport presets, sweep operations, or
capture hooks:

```js
export default {
  name: "my-plugin",
  viewport: {
    "my-laptop": { width: 1440, height: 900, dpr: 2, label: "MBP 14" },
  },
  sweepOp: {
    lighthouse: async (ctx, opts) => {
      // run lighthouse audit, write result at ctx.out
      return { score: 95 };
    },
  },
  beforeShoot: async (ctx) => { /* mutate ctx.flags */ },
  afterShoot:  async (ctx, meta) => { /* augment sidecar */ },
};
```

```bash
pursor shoot https://example.com --plugin ./my-plugin.js
```

Publish as `pursor-plugin-*` for auto-discovery.

### Built-in plugins

- **`plugin-audit`** — adds `audit` sweep-op (axe-core WCAG audit) and
  `every-viewport` sweep-op (capture at every preset). Adds `audit-canvas`
  viewport preset.
- **`plugin-demo`** — Reference implementation showing every plugin API
  hook: viewport presets, `nav` sweep-op (navbar walker), `beforeShoot`/
  `afterShoot` sidecar augmentation, and flag help.

---

## All CLI flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--preset` | string | `desktop-1280` | Named viewport preset |
| `--width` / `--height` | number | — | Custom viewport size |
| `--dpr` | number | `1` | Device pixel ratio |
| `--cursor` | string | `default` | `pointer`, `grab`, `crosshair`, `none` |
| `--grid` | bool | `false` | Overlay grid |
| `--grid-tile` | number | `64` | Grid tile size (px) |
| `--grid-color` | string | `rgba(255,0,255,0.35)` | Grid line color |
| `--layer` | string | `all` | `entity`, `terrain`, `hud`, `ui` |
| `--no-animation` | bool | `false` | Freeze CSS animations |
| `--no-hud` | bool | `false` | Hide HUD elements |
| `--wait-frame` | number | `600` | Wait ms for canvas stability |
| `--zoom` | number | `1` | Zoom level |
| `--panX` / `--panY` | number | `0` | Camera pan offset (px) |
| `--full` | bool | `false` | Full-page (not just viewport) |
| `--tags` | string | — | Comma-separated WCAG tags for audit |
| `--plugin` | path | — | Load a plugin file (repeatable) |
| `@file` | prefix | — | Read next arg from file |

---

## Library API

All functions available as named or default import:

```js
import { runShoot, runSweep, runAudit, captureDomSnapshot } from "pursor";
// Or:
import PurrVisual from "pursor";
```

### Capture functions

| Function | Returns | Never throws |
|---|---|---|
| `runShoot({url, out, flags?, prepare?, browser?})` | `{ url, out, ts, status, title, viewport, flags, error? }` | ✅ |
| `runShot(url, out, opts?)` | `{ url, out, status, title, fullPage }` | — |
| `runProbe(url)` | `{ url, status, title, navError, viewport }` | — |
| `runFrames({url, count?, intervalMs?, outDir?, flags?, browser?})` | `{ url, files[], viewport, ... }` | — |
| `runHover({url, selector, out, flags?})` | `{ url, out, selector, viewport, ... }` | — |
| `runDiff(url, refPath, out, threshold?, browser?)` | `{ url, refPath, numDiff, diffPct, equal, error? }` | — |
| `runWait(url, selector, timeoutMs?)` | `{ url, selector, found, timeoutMs }` | — |
| `runClick(url, selector, out?)` | `{ url, selector, clicked, out }` | — |
| `runType(url, selector, text, out?)` | `{ url, selector, text, typed, out }` | — |
| `runSeq(url, actionsJson, out?)` | `{ url, out, steps[], failed? }` | — |
| `runEval(url, js, out?)` | `{ url, result, out, ... }` | — |
| `runSweep(planPath, outDir?)` | `{ name, steps[], outDir, ... }` | ✅ (per-step) |
| `runAudit({url, tags?, outDir?, screenshot?, flags?})` | `{ url, violations, violationSummary, highlightedScreenshot?, ... }` | — |
| `captureDomSnapshot({url, out, flags?})` | `{ url, title, dom, selectorMap[], styles, viewport }` | — |

### Viewport helpers

| Export | Description |
|---|---|
| `listViewports()` | All registered presets (built-in + plugin) |
| `resolveViewport(flags)` | Resolve `--preset` / `--width` / `--height` to viewport object |
| `VIEWPORTS` | Built-in preset map |
| `applyCamera(page, opts)` | Zoom/pan via mouse wheel + drag on canvas |
| `waitForStableFrame(page, ms)` | Poll canvas until stable for `ms` |

### Plugin system

| Export | Description |
|---|---|
| `loadPlugins(paths?)` | Auto-load built-in plugins + user paths |
| `registerPlugin(plugin)` | Register a plugin manually |
| `listPlugins()` | Names of loaded plugins |
| `getSweepOp(name)` | Get a registered sweep operation |
| `getViewportPreset(name)` | Get a registered viewport preset |
| `listViewportPresets()` | All plugin-registered presets |
| `getFlagHelp()` | All plugin-registered flag descriptions |

### Selector healing

| Export | Description |
|---|---|
| `resolveHealedSelector(page, selector, opts?)` | Try selector chain, return first visible match |
| `healStepAction(page, action)` | Mutate action.selector → resolved selector |

### CI output

| Export | Description |
|---|---|
| `writeCiOutput(summary, dir)` | Write JUnit XML + GitHub annotations + Markdown |

### MCP Server

| Export | Description |
|---|---|
| `PurrVisualMCPServer` | MCP stdio server class |
| `loadMcpConfig()` | Load config from env or `~/.pursor/mcp-config.json` |
| `MCP_VERSION` | MCP protocol version string |

### Low-level (plugin authors)

| Export | Source |
|---|---|
| `launch()` / `newPage(browser, viewport)` | `runway.js` |
| `resolveLocator(page, selector)` / `parseTextSelector(s)` | `selector.js` |
| `parseFlags(argv)` / `asNum(v, dflt)` / `asBool(v, dflt)` | `util.js` |
| `nowIso()` / `shortHash(buf)` / `escapeHtml(s)` | `util.js` |
| `readArg(arg)` / `makeOut(name)` / `findStepPng(dir, name)` | `util.js` |
| `renderSweepHtml(summary)` | `util.js` |

### Subpath exports

```js
import { resolveLocator } from "pursor/selector";
import { launch } from "pursor/runway";
import { parseFlags } from "pursor/util";
import { overlayGrid } from "pursor/overlays";
import { captureDomSnapshot } from "pursor/dom-snapshot";
import { runAudit } from "pursor/plugin-audit";
import { resolveHealedSelector } from "pursor/selector-heal";
import { writeCiOutput } from "pursor/ci-output";
import { PurrVisualMCPServer } from "pursor/mcp";
```

---

## Sidecar JSON

Every capture writes a `.json` sidecar next to its PNG with metadata
(url, viewport, flags, timestamp, file size, SHA1 hash). DOM snapshots
write `.dom.json` with full element map. Audit reports write full
axe-core results to `audit.json`.

---

## Development

```bash
git clone <this repo>
cd pursor
npm install
npm install --save-dev playwright-core
npm test
```

All 32 tests use Node's built-in test runner. Coverage: unit tests for
viewport resolution, flag parsing, selector parsing, HTML escaping, hashing,
and end-to-end smoke tests for the full CLI pipeline.

```
src/           — 22 modules
test/          — 32 tests, 0 failures
plugins/       — 2 built-in plugins, auto-loaded
```

---

## License

MIT

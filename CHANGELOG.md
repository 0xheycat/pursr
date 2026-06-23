## 0.10.2 - 2026-06-23

**First-run setup and agent readiness improvements.**

### Added

- `pursr doctor` diagnoses Node, `playwright-core`, Chrome-compatible browser discovery, and packaged `SKILL.md` availability.
- `pursr setup` prints safe first-run guidance without downloading browsers automatically.
- Browser discovery now checks Chrome, Edge, Brave, Chromium, Dev/Beta/Canary/Nightly channels, PATH executables, and explicit `PURSR_BROWSER_PATH` / `CHROME_PATH`.
- Lightweight update notification checks npm at most once per 24 hours, writes to stderr, skips CI/non-interactive runs, and can be disabled with `PURSR_NO_UPDATE_NOTIFIER=1`.
- `SKILL.md` now describes first-run setup, operator mindset, capability fallback, social/form drafting, and side-effect approval boundaries.

## 0.10.1

**CLI argument parser and output-path reliability patch.**

### Fixed

- Flags can now appear before or after positional arguments without being mistaken for URLs, selectors, JavaScript, reference images, or plan paths.
- `shot` and `full` no longer pass flag names to Playwright as extensionless screenshot paths.
- `eval` no longer evaluates `--preset` as JavaScript when flags precede the URL.
- `click`, `type`, `hover`, `seq`, and `diff` preserve their positional argument order when mixed with flags.
- `--out` is honored as an exact file path and `--out-dir` writes the standard command filename inside the requested directory.
- Capture commands create missing parent directories before writing screenshots.
- `seq` and `operator` accept either inline JSON, `@file.json`, or a plain JSON file path.
- `report --help` returns usage instead of treating `--help` as a sweep summary path.
- `sweep` and `validate` now explain that they require a local JSON plan when given a URL.
- Simple commands now apply viewport flags such as `--preset`, `--width`, `--height`, and `--dpr` instead of silently ignoring them.

### Agent Support

- Added a packaged root `SKILL.md` covering CLI versus MCP selection, argument contracts, Visual Operator actions, the MCP inspection loop, safety, and common mistakes.

### Tests

- Added subprocess-level CLI regression coverage for `shot`, `full`, `shoot`, `eval`, `click`, `type`, `hover`, `seq`, `diff`, `sweep`, and `report --help`.
- Added parser unit coverage for mixed flag/positional ordering and boolean flags.
- Verified that `shoot` captures fresh content instead of reusing the previous screenshot.

## 0.10.0

**Recordable Visual Operator for CLI and agents.**

### Added

- `pursr operator` for running reusable JSON action plans without an MCP host.
- Native WebM recording in headless and visible browser sessions.
- Configurable `--start-delay` for games and applications that need extra startup time before the scripted actions begin.
- Final screenshot, action trace, diagnostics, and video path in operator results.
- Coordinate click and double-click actions for canvas and game interfaces.
- Drag actions using coordinates or selectors.
- `keyDown` and `keyUp` actions for held controls in games and canvas applications.
- `recordVideoDir` support in MCP session creation; the video path is returned when the session closes.
- Public `pursr/operator` module with the reusable `runOperator` API.

### Compatibility

- CLI and MCP share the same `BrowserSessionManager` and action format.
- CDP remains the authenticated-profile option; recording is rejected explicitly in CDP mode because the attached Chrome process owns its context.
- Existing commands and MCP tool names remain unchanged.

### Tests

- Added a real WebM recording test that verifies the EBML header and non-empty video payload.
- Added selector click, coordinate double-click, and coordinate drag coverage.

## 0.9.0

**Visual Operator for observable agent browser work.**

### Added

- Three persistent session modes: `headless`, `visible`, and `cdp`.
- Rendered agent cursor that is included in screenshots returned to vision models.
- Automatic cursor movement, target highlight, labels, and click markers for selector-based actions.
- Visual actions: `move`, `annotate`, and `clearAnnotations`.
- `operatorColor` and `slowMo` controls for demonstrations and visual reviews.
- CDP attachment to an existing Chrome profile for authenticated workflows.
- Public `pursr/visual-operator` module and `connectOverCDP` library export.

### Safety

- Operator colors are sanitized before being inserted into page markup or CSS.
- CDP mode opens a new tab and disconnects without terminating the owner browser.
- Visual mode is opt-in for headless sessions, preserving existing regression screenshots.

### Tests

- PNG-level visual assertion verifies that cursor, target, and click feedback are rendered.
- CDP integration verifies attachment, interaction, and safe disconnect from a real Chrome process.
- Existing SDK and browser regression coverage remains enabled.

## 0.8.1

**Official MCP SDK transport.**

### Changed

- Replaced the hand-written JSON-RPC and `Content-Length` stdio parser with `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk`.
- Tool failures now use standard MCP tool results with `isError: true`.
- Server version negotiation now reports the actual pursr package version.
- Added explicit runtime dependencies on `@modelcontextprotocol/sdk` and `zod`.

### Compatibility

- Added an end-to-end integration test using the official `Client` and `StdioClientTransport`.
- The SDK client verifies discovery of all 16 tools and completes a persistent open, act, snapshot, screenshot, diagnostics, resources, and close workflow.
- Existing pursr tool names, schemas, resources, library exports, and CLI commands remain unchanged.

### Tests

- Full suite: 71 passing, including a real MCP subprocess/client round trip.

## 0.8.0

**Persistent browser-agent sessions for MCP clients.**

### Added

- Eight session tools: `pursr_session_open`, `pursr_sessions`, `pursr_snapshot`, `pursr_act`, `pursr_screenshot`, `pursr_inspect`, `pursr_diagnostics`, and `pursr_session_close`.
- Persistent browser state across inspect, hover, click, typing, scrolling, navigation, reload, and screenshot calls.
- Direct MCP image content from `pursr_screenshot`, `pursr_shoot`, and `pursr_diff` so vision-capable agents can inspect captures without separately reading files.
- Compact rendered-state snapshots with geometry, semantics, UI state, and computed visual styles.
- Element inspection with computed styles and clipping/stacking ancestor context.
- Session diagnostics for console messages, page errors, request failures, and HTTP 4xx/5xx responses.
- Public `BrowserSessionManager` API and `pursr/session` subpath export.

### Changed

- DOM snapshot entries now include actual computed styles for visible elements.
- MCP surface grows from 8 capture/regression tools to 16 total tools.

### Tests

- Added persistent-state browser smoke coverage and MCP tool-manifest regression coverage. Suite: 70 passing.

## 0.7.3 (patch)

**Author field added + brand/name audit.**

- Added explicit `author` field to `package.json` (`{ name: "0xheycat", email: "0xheycat@gmail.com", url: "https://github.com/0xheycat" }`). Previously the maintainer was implicit (from the npm publish token), which made the npm page show no author and confused anyone trying to find the project owner.
- Audited the entire repo (`rg heycat --no-ignore`) — every remaining occurrence is part of the canonical GitHub username `0xheycat` (badges, README, package.json metadata, git commit history). Zero leftover references to bare `heycat`.

## 0.7.2 (minor)

**New `pursr check` CI command + `pursr_check` MCP tool. MCP `pursr_diff` now honors all flags. Baseline auto-derivation fix.**

### Added

- **`pursr check <url> [--preset ...] [--threshold 0.1] [--update] [--json]`** — the long-awaited CI exit-code command. Renders a URL at a given (url, viewport, flags) triple and diffs it against the stored baseline.
  - Exit `0` on equal (or just-updated), `1` on diff, `2` on no-baseline, `3` on internal error.
  - `--update` approves the current render as the new baseline in one step (no separate `pursr baseline approve` needed).
  - `--json` flag is accepted (output is already JSON).
  - Designed to drop into GitHub Actions / CI:
    ```
    - run: pursr check https://staging.example.com --preset desktop-1280 --no-animation --wait-frame 1500
    ```
- **`pursr_check` MCP tool** — same flow, callable from any MCP client (Codex, Claude Code, Cursor). Returns `{ status, equal, numDiff, diffPct, exitCode, baselineKey, saved, hint }` so the agent can branch on `status` ("equal" | "differ" | "size-mismatch" | "no-baseline" | "updated").
- **`runCheck` exported from `src/index.js`** — public API for embedding check in custom plugins.
- **Baseline auto-derivation** — `pursr baseline save <project> <png> <step>` now reads the sidecar `.json` (which `pursr shoot` always writes) to auto-fill `url`/`viewport`/`flags` and compute the correct `diffKey`. Previously you had to pass `--url` and `--meta-json` manually. `pursr baseline approve` and `pursr baseline show` got the same treatment.

### Fixed

- **`pursr_diff` MCP tool now honors all flags** (`--preset`, `--grid`, `--zoom`, `--pan-x`, `--pan-y`, `--no-animation`, `--wait-frame`, `--no-hud`, etc.). Previously the MCP `_diff` adapter called `runDiff(url, ref, out, threshold)` with no flags, silently dropping them. Schema expanded to match `pursr_shoot`'s flag set.
- **`pursr_diff` MCP schema now exposes `noAnimation` and `settleMs`** so CSR apps (React/Next.js bailing out to client-side rendering) can take a stable diff. `no-animation: true` is the recommended setting for diffing any animated page.
- **`baseDir()` in `src/baseline.js` now normalizes trailing slashes** so `http://localhost:3000/` and `http://localhost:3000` map to the same baseline folder. Without this fix, `pursr check` would say "no-baseline" even when a baseline was just saved under a different trailing-slash form.
- **`runCheck` strips action-only flags (`update`, `threshold`, `out`, `json`, `project`) from the diffKey** so the same URL+preset+animation combination always hashes to the same id regardless of which CLI flags were passed.

### Tests

- Added 3 regression-guard tests for `runCheck` and `diffKey`. Suite is now 68/68 passing in ~15s.

### Verified end-to-end against http://localhost:3000/ (PRED1CT, Next.js 14)

- `pursr shoot ... --no-animation --wait-frame 1500` → stable baseline (192KB PNG).
- `pursr baseline save <url> b1.png default` → auto-derived `id` from sidecar, wrote manifest with full `url`/`viewport`/`flags`.
- `pursr check <url> --preset desktop-1280 --no-animation --wait-frame 1500` → `status: "equal", numDiff: 0, exit: 0` ✅
- `pursr check ... --update` → approves current render, returns `status: "equal", exit: 0, approvedFrom: ...` ✅
- All 8 MCP tools (`pursr_shoot`, `pursr_diff`, `pursr_sweep`, `pursr_frames`, `pursr_probe`, `pursr_audit`, `pursr_dom_snapshot`, `pursr_check`) work over JSON-RPC stdio against localhost:3000.

## 0.7.1 (patch)

**Two bug fixes from end-to-end smoke testing.**

### Fixed

- **`pursr diff` now honors CLI flags** (`--preset`, `--grid`, `--cursor`, `--zoom`, `--pan-x`, `--pan-y`, `--wait-frame`, `--no-animation`, etc.). Previously, `runDiff` always shot at the default 1280x800 viewport, so `pursr diff <mobile-url> <desktop-baseline> --preset mobile-375` would render the current page at desktop size and report a false-positive `size mismatch`. The fix adds a `flags` parameter to `runDiff` and `runDiffWithAi`, threads it through `bin/pursr.mjs` via `parseFlags(argv.slice(5))`, and applies viewport, camera, and wait-frame to the page before screenshot.
- **`pursr audit` now finds `axe-core` from any cwd**. Previously, `getAxeSource` only looked in the project root, so running `pursr audit <url>` from `~` or any non-project directory errored with `axe-core not found`. The fix uses `createRequire(import.meta.url).resolve("axe-core")` as the primary lookup (which follows Node's normal module resolution and finds axe-core whether you're in the pursr repo, the published `pursr` package, or any project that installed axe-core), with the original path-based fallback list as a safety net.
- **Tests**: added 2 regression-guard unit tests for the new `runDiff`/`runDiffWithAi` signatures. Suite is now 65/65 passing in ~14s.

# Changelog

## 0.7.0 (breaking)

**Brand sweep: every `pursor` / `PURSOR_` reference removed. `pursr` is now the only brand.**

### Breaking changes (with deprecation shims where it makes sense)

- **Env vars renamed**: `PURSR_X` is the primary, `PURSOR_X` is the legacy alias.
  - `PURSR_BASELINES_DIR` (was `PURSOR_BASELINES_DIR`)
  - `PURSR_AUTH_DIR` (was `PURSOR_AUTH_DIR`)
  - `PURSR_MCP_STATE` (was `PURSOR_MCP_STATE`)
  - `PURSR_MCP_CONFIG` (was `PURSOR_MCP_CONFIG`)
  - `PURSR_URL` (was `PURSOR_URL`)
  - `PURSR_DEBUG` (was `PURSOR_DEBUG`)
  - `PURSR_AI_BASE_URL`, `PURSR_AI_API_KEY`, `PURSR_AI_MODEL` (were `PURSOR_AI_*`)
  - Old `PURSOR_*` still works — one-time deprecation warning to stderr, then silent.
- **MCP tool names**: `pursr_shoot`, `pursr_diff`, `pursr_sweep`, `pursr_frames`, `pursr_probe`, `pursr_audit`, `pursr_dom_snapshot` (were `pursor_*`).
- **MCP resource URIs**: `pursr://shoot/...`, `pursr://sweep/...` (were `pursor://`).
- **Default file dir**: `~/.pursr/` (was `~/.pursor/`).
- **Class name**: `PursrMCPServer` (was `PursorMCPServer`).
- **HAR capture Symbol**: `Symbol.for("pursr.har.capture")` (was `pursor.har.capture`).
- **Sweep report HTML title** + sweep `<title>` tag: `pursr sweep — ...` (was `pursor sweep — ...`).

### New

- `__PURSR_GET(name)` helper in `src/util.js` — reads `PURSR_X` first, falls back to `PURSOR_X`, warns once per legacy var per process. Imported and used by `auth.js`, `baseline.js`, `mcp.js`, `mcp-resources.js`, `ai-diff.js`, `bin/pursr.mjs`, `bin/pursr-mcp.mjs`.
- 3 new unit tests locking in the shim behavior (`test/unit.test.js`).

### No-op for users on `pursr@0.6.0`

- CLI subcommands unchanged.
- Subpath exports unchanged.
- Sweep plan format unchanged.
- Baseline/sweep/MCP/auth API on disk unchanged in shape (just the default dir moved).

## 0.6.0

- Add `pursr report --sweep` subcommand (PDF report via pdfkit, embedded PNGs, A4, page numbers).
- Add `pursr diff --ai` flag + `runDiffWithAi` library API (vision LLM diff summary, any OpenAI-compatible endpoint).
- `pdfkit@^0.19.1` added as a runtime dep.
- Subpath exports `./report` and `./ai-diff`.
- 7 new tests (PDF + AI diff). Total: 60 passing.

## 0.5.0

- Add `pursr watch <url>` for re-shoot on file change (glob-filtered).
- Add `pursr snap <url> <selector>` for component-level captures.
- 5 new tests. Total: 53 passing.

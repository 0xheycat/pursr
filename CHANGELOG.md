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
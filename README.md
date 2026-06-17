# @purr/visual

> Visual QA & audit plugin for the browser. Capture, sweep, and review any
> web target with multi-viewport, layered, animated, hover, grid, and cursor
> states. Built for game-style apps (isometric, canvas, dense scenes) but
> works fine on regular pages too.

## Install

```bash
# As a project dep
npm install @purr/visual
# Then make sure playwright-core + a system Chrome are available
npm install --save-dev playwright-core
```

`@purr/visual` does **not** bundle Chromium. It drives your system Chrome
(via Playwright) and falls back to the Codex cua_node runtime if you run
inside Codex Desktop.

## CLI

```bash
# Probe
npx purr-visual probe http://localhost:3010/farm

# Simple screenshot
npx purr-visual shot http://localhost:3010/farm

# Rich capture: viewport preset + cursor + grid overlay
npx purr-visual shoot http://localhost:3010/farm \
  --preset desktop-1280 \
  --cursor pointer \
  --grid --grid-tile 64

# Layer isolation (entity = canvas only, terrain = hide canvas, etc.)
npx purr-visual layer http://localhost:3010/farm entity

# Animation timeline: 8 frames at 200ms
npx purr-visual frames http://localhost:3010/farm 8 200 ./out/frames

# Hover state
npx purr-visual hover http://localhost:3010/farm "text=Build"

# Pixel diff
npx purr-visual diff http://localhost:3010/farm ./ref.png ./out/diff.png

# Batched capture plan
npx purr-visual sweep ./plans/m5.4-polish.json
```

## Library

```js
import { runShoot, runSweep, registerPlugin, listViewports } from "@purr/visual";

const meta = await runShoot({
  url: "http://localhost:3010/farm",
  out: "./out/farm.png",
  flags: { preset: "desktop-1280", cursor: "pointer", grid: true },
});

const summary = await runSweep("./plans/audit.json");
```

## Plugin API

Write your own plugin to add viewport presets, sweep-ops, or per-shoot
hooks:

```js
// my-plugin.js
export default {
  name: "my-plugin",
  viewport: {
    "my-laptop": { width: 1440, height: 900, dpr: 2, label: "MBP 14" },
  },
  sweepOp: {
    lighthouse: async (ctx, opts) => {
      // ... run lighthouse, write file at ctx.out
      return { score: 95 };
    },
  },
  beforeShoot: async (ctx) => { /* mutate ctx.flags */ },
  afterShoot:  async (ctx, meta) => { /* augment sidecar */ },
};
```

Load it at runtime:

```bash
npx purr-visual shoot http://localhost:3010/farm --plugin ./my-plugin.js
```

Or publish it as `@purr/visual-plugin-my-plugin` — `@purr/visual` will
auto-load any installed `@purr/visual-plugin-*` package.

## Built-in plugins

- **`@purr/visual-plugin-purrfarm`** — PurrFarm-aware viewport aliases
  and a `nav` sweep-op that walks every bottom-nav button and captures
  a frame.
- **`@purr/visual-plugin-audit`** — A `every-viewport` sweep-op that
  captures one shot at every registered viewport preset.

## Subcommands

| Subcommand | Purpose |
|---|---|
| `probe` | Health check (status, title, navError) |
| `shot` / `full` | Viewport / full-page screenshot |
| `eval` | Run JS in the page, return result |
| `click` / `type` / `wait` | Single-shot interaction |
| `seq` | Multi-step JSON script |
| `diff` | pixelmatch vs a reference PNG |
| `viewports` | List all viewport presets |
| `shoot` | Rich capture with flags |
| `layer` | Capture one isolated layer |
| `frames` | N-frame timeline at interval |
| `hover` | Single hover state capture |
| `sweep` | Batched capture plan with HTML report |

## Sidecar JSON

Every capture writes a `.json` next to the PNG with metadata (url,
viewport, flags, ts, size, hash). The sweep report uses these.

## Development

```bash
git clone <this repo>
cd purr-visual
npm install
npm test
```

## License

MIT
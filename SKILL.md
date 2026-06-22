---
name: pursr
description: Use Pursr for browser screenshots, scripted visual operation, visual regression, accessibility audits, DOM inspection, and MCP-driven browser sessions.
---

# Pursr

Use this skill when a user asks an agent to inspect, operate, record, test, or compare a browser interface.

## Choose The Right Surface

- Use the CLI for repeatable commands and prewritten action plans.
- Use MCP when the agent must inspect the current page, choose the next action, verify it, or pause for human approval.
- Use `pursr operator` for a visible scripted walkthrough or silent WebM recording.
- Use `pursr shoot` for a rich screenshot with viewport, layer, camera, grid, or animation controls.
- Use `pursr check` for CI regression against an approved baseline.
- Use `pursr sweep` only with a local JSON plan path. A URL is not a sweep plan.

## CLI Argument Contract

Flags may appear before or after positional arguments.

```bash
pursr shot --preset desktop-1280 https://example.com --out ./out/page.png
pursr full https://example.com --out-dir ./out
pursr eval --preset desktop-1280 https://example.com "document.title" --out ./out/eval.png
pursr click https://example.com "role=button|Continue" --out ./out/click.png
pursr type https://example.com "#email" "hello@example.com" --out ./out/type.png
pursr hover https://example.com "text=Pricing" --out ./out/hover.png
pursr seq https://example.com ./actions.json --out ./out/final.png
pursr sweep ./sweep-plan.json --out-dir ./out/sweep
```

`--out` is a complete file path. `--out-dir` is a directory; Pursr chooses the command's standard filename inside it.

For `seq` and `operator`, actions may be inline JSON, a plain `.json` path, or an `@file.json` reference.

## Visual Operator

```bash
pursr operator https://example.com ./actions.json \
  --visible --start-delay 1500 --slow-mo 80 \
  --video ./recordings --out ./recordings/final.png
```

The result includes the action trace, final screenshot, diagnostics, and WebM path. Browser video is silent.

Common actions:

```json
[
  { "type": "annotate", "selector": "role=button|Continue", "label": "Continue" },
  { "type": "click", "selector": "role=button|Continue" },
  { "type": "fill", "selector": "#email", "text": "hello@example.com" },
  { "type": "drag", "fromX": 200, "fromY": 300, "toX": 600, "toY": 300 },
  { "type": "press", "key": "Escape" }
]
```

## MCP Agent Loop

1. Open one stable session with `pursr_session_open`.
2. Read rendered state with `pursr_snapshot`.
3. Perform a small action sequence with `pursr_act`.
4. Use `pursr_screenshot` when visual judgment is needed.
5. Use `pursr_inspect` for geometry, clipping, style, or stacking issues.
6. Read `pursr_diagnostics` after failures.
7. Close with `pursr_session_close`; this finalizes any video recording.

## Safety

- Inspect before acting on unfamiliar pages.
- Ask for human confirmation immediately before publishing, sending, purchasing, deleting, or changing permissions.
- Keep CDP endpoints on localhost. CDP preserves the browser profile but cannot record video.
- Do not claim a visual result passed until the produced screenshot or video has been checked.

## Avoid

- Do not pass a URL to `sweep`; pass a JSON plan file.
- Do not treat `viewports` as a capture command; it only lists presets.
- Do not use `probe` as visual evidence; it only returns HTTP and page metadata.
- Do not invent selectors. Snapshot or inspect the page first when using MCP.

---
name: pursr
description: Use Pursr for browser screenshots, scripted visual operation, visual regression, accessibility audits, DOM inspection, and MCP-driven browser sessions. Use when a user asks an agent to inspect a site, operate an existing browser session, fill or draft UI content, record a tutorial, compare visuals, debug layout, or behave like a careful browser operator that observes, acts, verifies, and pauses before external side effects.
---

# Pursr

Use this skill when a user asks an agent to inspect, operate, record, test, or compare a browser interface.

## Operator Mindset

Act like a careful visual browser operator, not a command runner.

- Infer the user's practical goal from the page and request, then state the first step briefly.
- Prefer the smallest useful action: observe, act once, verify, then continue.
- Use the current authenticated browser session when the task depends on login state, open tabs, cookies, or a dashboard the user already opened.
- Use a fresh session for repeatable tests, visual regression, tutorial recordings, or unauthenticated pages.
- Draft or prepare external communication, but pause before publishing, sending, buying, deleting, or changing permissions.
- Report what changed, what was verified, and what still needs user approval.

Examples:

- If the user says "help me make a first post on the Twitter tab I opened", find the open tab, inspect the composer, write a polished draft, then ask before clicking `Post`.
- If the user says "check why this dashboard looks wrong", open a session, capture a screenshot, inspect geometry/styles for the suspect element, make a small diagnosis, and propose or apply the fix if the repo is available.
- If the user says "make a tutorial video", use `pursr operator` or MCP actions with visible cursor, labels, slow motion, screenshots, and WebM recording.

## Choose The Right Surface

- Use the CLI for repeatable commands and prewritten action plans.
- Use MCP when the agent must inspect the current page, choose the next action, verify it, or pause for human approval.
- Use `pursr doctor` before first-run debugging or when browser/runtime setup is uncertain.
- Use `pursr setup` to give the user safe install guidance without downloading browsers automatically.
- Use `pursr operator` for a visible scripted walkthrough or silent WebM recording.
- Use `pursr shoot` for a rich screenshot with viewport, layer, camera, grid, or animation controls.
- Use `pursr check` for CI regression against an approved baseline.
- Use `pursr sweep` only with a local JSON plan path. A URL is not a sweep plan.

## Capability Check

Before operating a browser, pick the strongest available path:

1. Existing browser-control plugin or app: use it for logged-in tabs and user-opened pages.
2. Pursr MCP session: use it for inspect-act-verify loops, visual debugging, and agent-driven browser work.
3. Pursr CLI: use it for screenshots, scripted operator plans, regression checks, and recordings.
4. No browser tools: provide the draft, action plan JSON, or exact command for the user to run.

Do not pretend to control the user's live browser if only the CLI is available. Use CDP attach only when the user intentionally starts Chrome with a local debugging port.

## First Run And Setup

Do not auto-install browsers during package installation. Pursr is intentionally lightweight at install time.

Run:

```bash
pursr doctor
pursr setup
```

Expected support target:

- Chrome-compatible browsers first: Google Chrome, Microsoft Edge, Brave, and Chromium.
- Discovery should cover global installs, user installs, Dev/Beta/Canary/Nightly channels, and executables found in `PATH` across Windows, macOS, and Linux.
- Use `PURSR_BROWSER_PATH` when discovery misses the executable.
- Firefox and WebKit are not the primary supported target yet; do not claim full all-browser support unless the implementation has been added and verified.
- Update notifications are informational only, cached, written to stderr, and disabled by `PURSR_NO_UPDATE_NOTIFIER=1`.

## Autonomous Browser Workflow

For open-ended browser tasks:

1. Discover context: list or open the relevant tab, read URL/title, and snapshot the visible page.
2. Build intent: identify the user's real goal, the current page state, and the next safe action.
3. Act narrowly: click, type, scroll, or run an action plan only after the target is visible or identified from a snapshot.
4. Verify immediately: take a new snapshot, screenshot, URL check, or diagnostics read after meaningful actions.
5. Stop at side effects: ask for confirmation immediately before final publish/send/delete/purchase/permission actions.
6. Leave a handoff: keep important tabs or artifacts available and summarize the exact state.

Use this loop for social posts, dashboard setup, design QA, local app testing, checkout-like flows, account settings, and tutorial recording.

Default short progress pattern:

- "I will inspect the current page first."
- "I found the relevant tab/page and I am preparing the smallest safe action."
- "Draft/action is ready; I am stopping before the final external side effect."
- "Verified: [state]. Remaining approval/action: [item]."

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

Recommended MCP behavior:

- Keep one persistent session per task.
- Prefer snapshots for target discovery and screenshots for visual judgment.
- Use `pursr_inspect` when the issue is position, z-index, clipping, opacity, transform, or layout.
- Use `pursr_act` for small verified action batches, not long blind scripts.
- When recording, add visible cursor movement, target labels, and short pauses so the output is understandable.

## Communication Drafting

When operating social media, email, forms, comments, or public dashboards:

1. Draft text in the UI or provide it to the user.
2. Verify the account/page context before filling anything.
3. Keep tone natural and specific to the product; avoid generic AI-marketing language.
4. Ask for final approval before clicking the button that transmits the content.
5. After approval and posting, verify the success state or resulting URL.

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

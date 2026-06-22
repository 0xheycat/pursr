// One-shot Visual Operator workflow for CLI and library consumers.

import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { BrowserSessionManager } from "./session.js";

function normalizeActions(actions) {
  if (typeof actions === "string") actions = JSON.parse(actions);
  if (!Array.isArray(actions) || !actions.length) throw new Error("operator actions must be a non-empty JSON array");
  return actions;
}

export async function runOperator({
  url,
  actions,
  out,
  outputDir = process.cwd(),
  sessionId = `operator-${Date.now().toString(36)}`,
  flags = {},
} = {}) {
  if (!url) throw new Error("operator url is required");
  const steps = normalizeActions(actions);
  const screenshotOut = resolve(out || join(outputDir, `${sessionId}.png`));
  mkdirSync(dirname(screenshotOut), { recursive: true });

  const manager = new BrowserSessionManager({ outputDir });
  let opened = null;
  let acted = null;
  let shot = null;
  let diagnostics = null;
  let closed = null;
  try {
    opened = await manager.open({
      sessionId,
      url,
      storageState: flags.storageState,
      flags: { ...flags, visual: flags.visual !== false },
    });
    if (Number(flags.startDelayMs) > 0) {
      await manager.get(sessionId).page.waitForTimeout(Number(flags.startDelayMs));
    }
    acted = await manager.act(sessionId, steps);
    shot = await manager.screenshot(sessionId, { out: screenshotOut, full: !!flags.full });
    diagnostics = manager.diagnostics(sessionId);
  } finally {
    closed = await manager.close(sessionId).catch(() => ({ sessionId, closed: false, video: null }));
  }

  return {
    ok: !acted?.failed,
    sessionId,
    mode: opened?.mode,
    visual: opened?.visual,
    url: acted?.url || opened?.url || url,
    title: acted?.title || opened?.title || null,
    trace: acted?.trace || [],
    screenshot: shot?.out || null,
    video: closed?.video || null,
    diagnostics,
  };
}

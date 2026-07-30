import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { PursrMCPServer } from "../src/mcp.js";
import { BrowserSessionManager } from "../src/session.js";

function mockSession(manager, id, overrides = {}) {
  const page = {
    url: () => "http://127.0.0.1:3000/game",
    title: async () => "PurrFarm",
    ...overrides.page,
  };
  manager.sessions.set(id, {
    id,
    page,
    context: overrides.context ?? { close: async () => {} },
    browser: overrides.browser ?? { close: async () => {} },
    mode: overrides.mode ?? "headless",
    visual: false,
    operatorOptions: {},
    diagnostics: { console: [], errors: [], requests: [], responses: [] },
    video: overrides.video ?? null,
    createdAt: new Date().toISOString(),
  });
  return page;
}

test("MCP action schema exposes timeout, force, and selector screenshot recovery controls", () => {
  const tools = new PursrMCPServer()._toolDefs();
  const act = tools.find((tool) => tool.name === "pursr_act");
  const screenshot = tools.find((tool) => tool.name === "pursr_screenshot");
  const actionProperties = act.inputSchema.properties.actions.items.properties;

  assert.equal(actionProperties.timeoutMs.type, "number");
  assert.equal(actionProperties.force.type, "boolean");
  assert.match(actionProperties.force.description, /never enabled automatically/i);
  assert.equal(screenshot.inputSchema.properties.timeoutMs.type, "number");
  assert.match(screenshot.description, /clip/i);
});

test("selector actions forward explicit timeout and force instead of using hidden Playwright defaults", async () => {
  const calls = [];
  const locator = {
    first() { return this; },
    waitFor: async (options) => calls.push(["waitFor", options]),
    click: async (options) => calls.push(["click", options]),
  };
  const manager = new BrowserSessionManager();
  mockSession(manager, "action-contract", {
    page: { locator: () => locator },
  });

  const result = await manager.act("action-contract", [{
    type: "click",
    selector: "#btn-guide",
    timeoutMs: 4321,
    force: true,
  }]);

  assert.equal(result.failed, false);
  assert.deepEqual(calls, [
    ["waitFor", { state: "attached", timeout: 4321 }],
    ["click", { timeout: 4321, force: true }],
  ]);
});

test("selector screenshot falls back to a bounded page clip when locator stability never settles", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-selector-fallback-"));
  const file = join(outputDir, "modal.png");
  const calls = [];
  const locator = {
    first() { return this; },
    screenshot: async (options) => {
      calls.push(["locatorScreenshot", options]);
      throw new Error("Timeout 250ms exceeded while waiting for element to be stable");
    },
    waitFor: async (options) => calls.push(["waitFor", options]),
    boundingBox: async () => ({ x: 20, y: 30, width: 320, height: 180 }),
  };
  const manager = new BrowserSessionManager({ outputDir });
  mockSession(manager, "selector-fallback", {
    page: {
      locator: () => locator,
      screenshot: async (options) => {
        calls.push(["pageScreenshot", options]);
        const png = new PNG({ width: 2, height: 2 });
        writeFileSync(options.path, PNG.sync.write(png));
      },
    },
  });

  try {
    const result = await manager.screenshot("selector-fallback", {
      out: file,
      selector: ".modal-wrap",
      timeoutMs: 250,
    });

    assert.equal(result.captureMode, "clip-fallback");
    assert.match(result.fallbackError, /waiting for element to be stable/i);
    assert.deepEqual(calls, [
      ["locatorScreenshot", { path: file, timeout: 250, animations: "disabled" }],
      ["waitFor", { state: "visible", timeout: 250 }],
      ["pageScreenshot", {
        path: file,
        clip: { x: 20, y: 30, width: 320, height: 180 },
        timeout: 250,
        animations: "disabled",
      }],
    ]);
    assert.ok(readFileSync(file).length > 0);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("close is bounded and removes a session even when a browser context never resolves", async () => {
  const manager = new BrowserSessionManager({ closeTimeoutMs: 25 });
  mockSession(manager, "stuck-close", {
    context: { close: async () => await new Promise(() => {}) },
    browser: { close: async () => {} },
  });

  const started = Date.now();
  const result = await manager.close("stuck-close");
  const elapsed = Date.now() - started;

  assert.equal(result.closed, true);
  assert.equal(manager.size, 0);
  assert.ok(elapsed < 500, `close should be bounded, took ${elapsed}ms`);
  assert.ok(result.warnings.some((warning) => /context close timed out/i.test(warning)));
});
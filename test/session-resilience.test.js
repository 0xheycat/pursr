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

test("explicit force falls back to DOM dispatch when Playwright cannot settle a visible selector", async () => {
  const calls = [];
  const locator = {
    first() { return this; },
    waitFor: async (options) => calls.push(["waitFor", options]),
    click: async (options) => {
      calls.push(["click", options]);
      throw new Error("Timeout while waiting for element to be stable");
    },
    dispatchEvent: async (type, init, options) => calls.push(["dispatchEvent", type, init, options]),
  };
  const manager = new BrowserSessionManager();
  mockSession(manager, "forced-dispatch", {
    page: { locator: () => locator },
  });

  const result = await manager.act("forced-dispatch", [{
    type: "click",
    selector: "#btn-guide",
    timeoutMs: 250,
    force: true,
  }]);

  assert.equal(result.failed, false);
  assert.equal(result.trace[0].actionMode, "dom-click");
  assert.match(result.trace[0].playwrightError, /element to be stable/i);
  assert.deepEqual(calls, [
    ["waitFor", { state: "attached", timeout: 250 }],
    ["click", { timeout: 250, force: true }],
    ["dispatchEvent", "click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 1,
      button: 0,
    }, { timeout: 250 }],
  ]);
});

test("explicit force uses page DOM dispatch when the locator attached wait itself times out", async () => {
  const calls = [];
  const locator = {
    first() { return this; },
    waitFor: async (options) => {
      calls.push(["waitFor", options]);
      throw new Error("Timeout while waiting for locator to attach");
    },
    click: async (options) => calls.push(["click", options]),
    dispatchEvent: async (...args) => {
      calls.push(["dispatchEvent", ...args]);
      throw new Error("locator dispatch should not be retried after attached wait timeout");
    },
  };
  const manager = new BrowserSessionManager();
  mockSession(manager, "forced-wait-dispatch", {
    page: {
      locator: () => locator,
      evaluate: async (_fn, payload) => calls.push(["evaluate", payload]),
    },
  });

  const result = await manager.act("forced-wait-dispatch", [{
    type: "click",
    selector: "#btn-guide",
    timeoutMs: 250,
    force: true,
  }]);

  assert.equal(result.failed, false);
  assert.equal(result.trace[0].actionMode, "dom-click");
  assert.match(result.trace[0].playwrightError, /locator to attach/i);
  assert.deepEqual(calls, [
    ["waitFor", { state: "attached", timeout: 250 }],
    ["evaluate", {
      selector: "#btn-guide",
      eventType: "click",
      detail: 1,
    }],
  ]);
});

test("selector screenshot falls back to bounded CDP clipping when locator stability never settles", async () => {
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
  const png = new PNG({ width: 2, height: 2 });
  const pngBase64 = PNG.sync.write(png).toString("base64");
  const cdp = {
    send: async (method, params) => {
      calls.push(["cdpSend", method, params]);
      return { data: pngBase64 };
    },
    detach: async () => calls.push(["cdpDetach"]),
  };
  const context = {
    close: async () => {},
    newCDPSession: async () => {
      calls.push(["newCDPSession"]);
      return cdp;
    },
  };
  const manager = new BrowserSessionManager({ outputDir });
  const page = mockSession(manager, "selector-fallback", {
    context,
    page: {
      locator: () => locator,
      evaluate: async () => ({ x: 5, y: 7 }),
      screenshot: async (options) => calls.push(["pageScreenshot", options]),
    },
  });
  page.context = () => context;

  try {
    const result = await manager.screenshot("selector-fallback", {
      out: file,
      selector: ".modal-wrap",
      timeoutMs: 250,
    });

    assert.equal(result.captureMode, "cdp-clip-fallback");
    assert.match(result.fallbackError, /waiting for element to be stable/i);
    assert.deepEqual(calls, [
      ["locatorScreenshot", { path: file, timeout: 250, animations: "disabled" }],
      ["waitFor", { state: "visible", timeout: 250 }],
      ["newCDPSession"],
      ["cdpSend", "Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 25, y: 37, width: 320, height: 180, scale: 1 },
      }],
      ["cdpDetach"],
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

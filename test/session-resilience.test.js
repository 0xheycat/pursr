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
    title: async () => "Visual Test Fixture",
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

  assert.equal(act.inputSchema.properties.timeoutMs.type, "number");
  assert.match(act.inputSchema.properties.timeoutMs.description, /eval actions are bounded/i);
  assert.equal(actionProperties.timeoutMs.type, "number");
  assert.equal(actionProperties.url.type, "string");
  assert.match(actionProperties.url.description, /navigate actions/i);
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

test("eval actions return a bounded failure instead of holding the MCP transport", { timeout: 1_500 }, async () => {
  const manager = new BrowserSessionManager();
  mockSession(manager, "bounded-eval", {
    page: {
      evaluate: async () => await new Promise(() => {}),
    },
  });

  const started = Date.now();
  const result = await manager.act(
    "bounded-eval",
    [{ type: "eval", js: "new Promise(() => {})" }],
    { timeoutMs: 40 },
  );
  const elapsed = Date.now() - started;

  assert.equal(result.failed, true);
  assert.match(result.trace[0].error, /eval action timed out after 40ms/i);
  assert.ok(elapsed < 1_000, `bounded eval should settle well before the MCP transport window, took ${elapsed}ms`);
});

test("timed-out eval returns bounded metadata and does not poison the next queued action", { timeout: 1_000 }, async () => {
  const manager = new BrowserSessionManager();
  let evaluateCalls = 0;
  mockSession(manager, "queue-recovery", {
    page: {
      evaluate: async () => {
        evaluateCalls += 1;
        if (evaluateCalls === 1) return await new Promise(() => {});
        return 42;
      },
      title: async () => await new Promise(() => {}),
    },
  });

  const firstStarted = Date.now();
  const first = await manager.act(
    "queue-recovery",
    [{ type: "eval", js: "new Promise(() => {})", timeoutMs: 30 }],
    { operationTimeoutMs: 120 },
  );
  const firstElapsed = Date.now() - firstStarted;

  assert.equal(first.failed, true);
  assert.match(first.trace[0].error, /eval action timed out after 30ms/i);
  assert.equal(first.title, null);
  assert.ok(firstElapsed < 300, `timed-out action should return bounded metadata, took ${firstElapsed}ms`);

  const secondStarted = Date.now();
  const second = await manager.act(
    "queue-recovery",
    [{ type: "eval", js: "21 * 2", timeoutMs: 100 }],
    { operationTimeoutMs: 250 },
  );
  const secondElapsed = Date.now() - secondStarted;

  assert.equal(second.failed, false);
  assert.equal(second.trace[0].result, 42);
  assert.ok(secondElapsed < 300, `next queued action should not inherit the prior timeout, took ${secondElapsed}ms`);
});

test("operationTimeoutMs bounds the entire action batch instead of summing past transport budgets", { timeout: 1_000 }, async () => {
  const manager = new BrowserSessionManager();
  mockSession(manager, "operation-budget", {
    page: {
      waitForTimeout: async () => await new Promise(() => {}),
    },
  });

  const started = Date.now();
  await assert.rejects(
    manager.act(
      "operation-budget",
      [{ type: "sleep", ms: 60_000 }],
      { operationTimeoutMs: 40 },
    ),
    /browser act operation timed out after 40ms/i,
  );
  assert.ok(Date.now() - started < 300, "whole-operation deadline must beat the client transport deadline");
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
    assert.equal(calls[0][0], "locatorScreenshot");
    assert.match(calls[0][1].path, /\.modal\.png\.tmp-/);
    assert.notEqual(calls[0][1].path, file);
    assert.ok(calls[0][1].timeout > 0 && calls[0][1].timeout <= 250);
    assert.equal(calls[0][1].animations, "disabled");
    assert.equal(calls[1][0], "waitFor");
    assert.equal(calls[1][1].state, "visible");
    assert.ok(calls[1][1].timeout > 0 && calls[1][1].timeout <= 250);
    assert.deepEqual(calls.slice(2), [
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

test("high-resolution artifact-first screenshot can omit inline base64 without losing the PNG", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-artifact-first-"));
  const file = join(outputDir, "high-res.png");
  const png = new PNG({ width: 3840, height: 4 });
  const buffer = PNG.sync.write(png);
  const manager = new BrowserSessionManager({ outputDir });
  mockSession(manager, "artifact-first", {
    page: {
      screenshot: async () => buffer,
    },
  });

  try {
    const result = await manager.screenshot("artifact-first", {
      out: file,
      timeoutMs: 3_000,
      operationTimeoutMs: 4_000,
      includeData: false,
      strategy: "playwright",
      animations: "allow",
    });

    assert.equal("data" in result, false);
    assert.equal(result.image.width, 3840);
    assert.ok(readFileSync(file).equals(buffer));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("viewport screenshot falls back to CDP when Playwright capture times out", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-viewport-fallback-"));
  const file = join(outputDir, "viewport.png");
  const calls = [];
  const png = new PNG({ width: 3, height: 2 });
  const pngBase64 = PNG.sync.write(png).toString("base64");
  const cdp = {
    send: async (method, params) => {
      calls.push(["cdpSend", method, params]);
      if (method !== "Page.captureScreenshot") throw new Error(`unexpected CDP method: ${method}`);
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
  const page = mockSession(manager, "viewport-fallback", {
    context,
    page: {
      screenshot: async (options) => {
        calls.push(["pageScreenshot", options]);
        throw new Error("Timeout 250ms exceeded while waiting for fonts to load");
      },
    },
  });
  page.context = () => context;

  try {
    const result = await manager.screenshot("viewport-fallback", {
      out: file,
      timeoutMs: 250,
    });

    assert.equal(result.captureMode, "cdp-viewport-fallback");
    assert.match(result.fallbackError, /waiting for fonts to load/i);
    const decoded = PNG.sync.read(readFileSync(file));
    assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 3, height: 2 });
    assert.equal(calls[0][0], "pageScreenshot");
    assert.match(calls[0][1].path, /\.viewport\.png\.tmp-/);
    assert.notEqual(calls[0][1].path, file);
    assert.equal(calls[0][1].fullPage, false);
    assert.ok(calls[0][1].timeout > 0 && calls[0][1].timeout <= 250);
    assert.equal(calls[0][1].animations, "disabled");
    const capture = calls.find((call) => call[0] === "cdpSend" && call[1] === "Page.captureScreenshot");
    assert.ok(capture, "viewport fallback should invoke Page.captureScreenshot");
    assert.equal(capture[2].captureBeyondViewport, false);
    assert.deepEqual(calls.at(-1), ["cdpDetach"]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("full-page screenshot falls back to CDP when Playwright capture times out", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-full-page-fallback-"));
  const file = join(outputDir, "full-page.png");
  const calls = [];
  const png = new PNG({ width: 4, height: 6 });
  const pngBase64 = PNG.sync.write(png).toString("base64");
  const cdp = {
    send: async (method, params) => {
      calls.push(["cdpSend", method, params]);
      if (method === "Page.getLayoutMetrics") {
        return { cssContentSize: { x: 0, y: 0, width: 1440, height: 3200 } };
      }
      if (method === "Page.captureScreenshot") return { data: pngBase64 };
      throw new Error(`unexpected CDP method: ${method}`);
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
  const page = mockSession(manager, "full-page-fallback", {
    context,
    page: {
      screenshot: async (options) => {
        calls.push(["pageScreenshot", options]);
        throw new Error("Timeout 250ms exceeded while waiting for fonts to load");
      },
    },
  });
  page.context = () => context;

  try {
    const result = await manager.screenshot("full-page-fallback", {
      out: file,
      full: true,
      timeoutMs: 250,
    });

    assert.equal(result.captureMode, "cdp-full-page-fallback");
    assert.match(result.fallbackError, /waiting for fonts to load/i);
    const decoded = PNG.sync.read(readFileSync(file));
    assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 4, height: 6 });
    assert.equal(calls[0][0], "pageScreenshot");
    assert.match(calls[0][1].path, /\.full-page\.png\.tmp-/);
    assert.notEqual(calls[0][1].path, file);
    assert.equal(calls[0][1].fullPage, true);
    assert.ok(calls[0][1].timeout > 0 && calls[0][1].timeout <= 250);
    assert.equal(calls[0][1].animations, "disabled");
    const capture = calls.find((call) => call[0] === "cdpSend" && call[1] === "Page.captureScreenshot");
    assert.ok(capture, "full-page fallback should invoke Page.captureScreenshot");
    assert.equal(capture[2].captureBeyondViewport, true);
    assert.deepEqual(capture[2].clip, {
      x: 0, y: 0, width: 1440, height: 3200, scale: 1,
    });
    assert.deepEqual(calls.at(-1), ["cdpDetach"]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("close bypasses a poisoned operation queue", { timeout: 750 }, async () => {
  const manager = new BrowserSessionManager({ closeTimeoutMs: 20 });
  mockSession(manager, "poisoned-queue");
  const session = manager.get("poisoned-queue");
  session.operationTail = new Promise(() => {});

  const started = Date.now();
  const result = await manager.close("poisoned-queue");
  const elapsed = Date.now() - started;

  assert.equal(result.closed, true);
  assert.equal(manager.size, 0);
  assert.ok(elapsed < 300, `force close must not wait behind the session queue, took ${elapsed}ms`);
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

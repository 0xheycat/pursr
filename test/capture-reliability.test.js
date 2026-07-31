import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { PursrMCPServer } from "../src/mcp.js";
import { BrowserSessionManager } from "../src/session.js";

function pngBuffer(width = 4, height = 3) {
  return PNG.sync.write(new PNG({ width, height }));
}

function mockSession(manager, id, { page = {}, context, browser, mode = "headless" } = {}) {
  const resolvedPage = {
    url: () => `http://127.0.0.1/${id}`,
    title: async () => "Visual Test Fixture",
    ...page,
  };
  manager.sessions.set(id, {
    id,
    page: resolvedPage,
    context: context ?? { close: async () => {} },
    browser: browser ?? { close: async () => {} },
    mode,
    visual: false,
    operatorOptions: {},
    diagnostics: { console: [], errors: [], requests: [], responses: [] },
    video: null,
    createdAt: new Date().toISOString(),
  });
  return resolvedPage;
}

function cdpContext(send, calls = []) {
  const cdp = {
    send: async (method, params) => {
      calls.push(["cdpSend", method, params]);
      return await send(method, params);
    },
    detach: async () => calls.push(["cdpDetach"]),
  };
  return {
    close: async () => {},
    newCDPSession: async () => {
      calls.push(["newCDPSession"]);
      return cdp;
    },
  };
}

test("MCP screenshot response preserves structured recovery evidence", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-mcp-capture-meta-"));
  const file = join(outputDir, "capture.png");
  const bytes = pngBuffer(7, 5);
  writeFileSync(file, bytes);
  const server = new PursrMCPServer({ defaultOutDir: outputDir });
  server.sessions.screenshot = async () => ({
    sessionId: "metadata",
    out: file,
    url: "http://127.0.0.1/metadata",
    data: bytes.toString("base64"),
    mimeType: "image/png",
    captureMode: "cdp-viewport-fallback",
    fallbackUsed: true,
    elapsedMs: 42,
    requestedTimeoutMs: 250,
    attempts: [
      { strategy: "playwright", status: "failed", durationMs: 25, errorCode: "PLAYWRIGHT_CAPTURE_TIMEOUT" },
      { strategy: "cdp", status: "success", durationMs: 17 },
    ],
    image: { width: 7, height: 5, bytes: bytes.length, mimeType: "image/png" },
  });

  try {
    const content = await server._callTool("pursr_screenshot", { sessionId: "metadata" });
    const metadata = JSON.parse(content.find((item) => item.type === "text").text);
    assert.equal(metadata.captureMode, "cdp-viewport-fallback");
    assert.equal(metadata.fallbackUsed, true);
    assert.equal(metadata.elapsedMs, 42);
    assert.equal(metadata.requestedTimeoutMs, 250);
    assert.deepEqual(metadata.attempts.map((attempt) => attempt.strategy), ["playwright", "cdp"]);
    assert.deepEqual(metadata.image, { width: 7, height: 5, bytes: bytes.length, mimeType: "image/png" });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("capture timeout is a total operation deadline even when CDP never resolves", { timeout: 750 }, async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-deadline-"));
  const manager = new BrowserSessionManager({ outputDir });
  const context = cdpContext(async () => await new Promise(() => {}));
  const page = mockSession(manager, "deadline", {
    context,
    page: { screenshot: async () => { throw new Error("Playwright capture timed out"); } },
  });
  page.context = () => context;

  try {
    const started = Date.now();
    await assert.rejects(
      manager.screenshot("deadline", { timeoutMs: 40 }),
      /deadline|timed out/i,
    );
    assert.ok(Date.now() - started < 300, "capture must settle within the total deadline");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("failed replacement preserves the previous valid artifact and structured causes", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-atomic-"));
  const file = join(outputDir, "stable.png");
  const original = pngBuffer(8, 6);
  writeFileSync(file, original);
  const manager = new BrowserSessionManager({ outputDir });
  const context = cdpContext(async () => { throw new Error("CDP compositor unavailable"); });
  const page = mockSession(manager, "atomic", {
    context,
    page: {
      screenshot: async ({ path }) => {
        writeFileSync(path, Buffer.from("partial output"));
        throw new Error("Playwright wrote a partial file then failed");
      },
    },
  });
  page.context = () => context;

  try {
    let failure;
    try {
      await manager.screenshot("atomic", { out: file, timeoutMs: 100 });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "capture should fail when both strategies fail");
    assert.equal(failure.code, "CAPTURE_FAILED");
    assert.deepEqual(failure.attempts.map((attempt) => attempt.strategy), ["playwright", "cdp"]);
    assert.deepEqual(readFileSync(file), original, "failed replacement must preserve the previous valid image");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("invalid CDP bytes are rejected and never published as an artifact", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-invalid-"));
  const file = join(outputDir, "invalid.png");
  const manager = new BrowserSessionManager({ outputDir });
  const context = cdpContext(async () => ({ data: Buffer.from("not a png").toString("base64") }));
  const page = mockSession(manager, "invalid", {
    context,
    page: { screenshot: async () => { throw new Error("Playwright capture failed"); } },
  });
  page.context = () => context;

  try {
    await assert.rejects(
      manager.screenshot("invalid", { out: file, timeoutMs: 100 }),
      /invalid.*png|image validation/i,
    );
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("auto strategy learns from a Playwright timeout and uses CDP first next time", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-adaptive-"));
  const bytes = pngBuffer(5, 4);
  let playwrightCalls = 0;
  const manager = new BrowserSessionManager({ outputDir });
  const context = cdpContext(async () => ({ data: bytes.toString("base64") }));
  const page = mockSession(manager, "adaptive", {
    context,
    page: {
      screenshot: async ({ path }) => {
        playwrightCalls += 1;
        if (playwrightCalls === 1) throw new Error("Playwright timeout while waiting for fonts");
        writeFileSync(path, bytes);
      },
    },
  });
  page.context = () => context;

  try {
    await manager.screenshot("adaptive", { timeoutMs: 100 });
    const second = await manager.screenshot("adaptive", { timeoutMs: 100 });
    assert.equal(playwrightCalls, 1, "degraded Playwright capture should not be retried immediately");
    assert.equal(second.attempts[0].strategy, "cdp");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("explicit CDP strategy skips Playwright without removing caller control", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-force-cdp-"));
  const bytes = pngBuffer(3, 3);
  let playwrightCalls = 0;
  const manager = new BrowserSessionManager({ outputDir });
  const context = cdpContext(async () => ({ data: bytes.toString("base64") }));
  const page = mockSession(manager, "force-cdp", {
    context,
    page: {
      screenshot: async () => {
        playwrightCalls += 1;
        throw new Error("Playwright should not run for strategy=cdp");
      },
    },
  });
  page.context = () => context;

  try {
    const result = await manager.screenshot("force-cdp", { strategy: "cdp", timeoutMs: 100 });
    assert.equal(playwrightCalls, 0);
    assert.equal(result.attempts[0].strategy, "cdp");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("adaptive capture health is isolated per browser session", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-isolation-"));
  const bytes = pngBuffer(4, 4);
  const manager = new BrowserSessionManager({ outputDir });
  const calls = { a: 0, b: 0 };

  for (const id of ["a", "b"]) {
    const context = cdpContext(async () => ({ data: bytes.toString("base64") }));
    const page = mockSession(manager, id, {
      context,
      page: {
        screenshot: async ({ path }) => {
          calls[id] += 1;
          if (id === "a") throw new Error("session a Playwright timeout");
          writeFileSync(path, bytes);
        },
      },
    });
    page.context = () => context;
  }

  try {
    await manager.screenshot("a", { timeoutMs: 100 });
    await manager.screenshot("a", { timeoutMs: 100 });
    await manager.screenshot("b", { timeoutMs: 100 });
    assert.deepEqual(calls, { a: 1, b: 1 });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("same-session capture and action are serialized in arrival order", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-queue-"));
  const bytes = pngBuffer(4, 3);
  const events = [];
  const manager = new BrowserSessionManager({ outputDir });
  mockSession(manager, "queue", {
    page: {
      screenshot: async ({ path }) => {
        events.push("capture-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        writeFileSync(path, bytes);
        events.push("capture-end");
      },
      evaluate: async () => {
        events.push("action");
        return "done";
      },
    },
  });

  try {
    await Promise.all([
      manager.screenshot("queue", { timeoutMs: 200 }),
      manager.act("queue", [{ type: "eval", js: "1 + 1" }]),
    ]);
    assert.deepEqual(events, ["capture-start", "capture-end", "action"]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("different browser sessions remain concurrent", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-parallel-"));
  const bytes = pngBuffer(2, 2);
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const manager = new BrowserSessionManager({ outputDir });

  for (const id of ["one", "two"]) {
    mockSession(manager, id, {
      page: {
        screenshot: async ({ path }) => {
          started.push(id);
          await gate;
          writeFileSync(path, bytes);
        },
      },
    });
  }

  try {
    const captures = [
      manager.screenshot("one", { timeoutMs: 200 }),
      manager.screenshot("two", { timeoutMs: 200 }),
    ];
    for (let attempt = 0; attempt < 20 && started.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(new Set(started), new Set(["one", "two"]));
    release();
    await Promise.all(captures);
  } finally {
    release?.();
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("close waits for an active same-session capture before releasing browser resources", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-close-queue-"));
  const bytes = pngBuffer(4, 3);
  const events = [];
  const manager = new BrowserSessionManager({ outputDir, closeTimeoutMs: 200 });
  mockSession(manager, "close-queue", {
    context: { close: async () => events.push("context-close") },
    browser: { close: async () => events.push("browser-close") },
    page: {
      screenshot: async ({ path }) => {
        events.push("capture-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        writeFileSync(path, bytes);
        events.push("capture-end");
      },
    },
  });

  try {
    const capture = manager.screenshot("close-queue", { timeoutMs: 200 });
    for (let attempt = 0; attempt < 20 && !events.includes("capture-start"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const closing = manager.close("close-queue");
    const [, result] = await Promise.all([capture, closing]);

    assert.equal(result.closed, true);
    assert.equal(manager.size, 0);
    assert.deepEqual(events, [
      "capture-start",
      "capture-end",
      "context-close",
      "browser-close",
    ]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("snapshot and inspect share the same-session queue with capture", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-read-queue-"));
  const bytes = pngBuffer(4, 3);
  const events = [];
  let captureIndex = 0;
  const manager = new BrowserSessionManager({ outputDir });
  const locator = {
    first() { return this; },
    waitFor: async () => {},
    evaluate: async () => {
      events.push("inspect");
      return {
        tag: "div",
        html: "<div id=target></div>",
        rect: { x: 0, y: 0, width: 10, height: 10 },
        computedStyle: {},
        ancestors: [],
      };
    },
  };
  mockSession(manager, "read-queue", {
    page: {
      locator: () => locator,
      screenshot: async ({ path }) => {
        captureIndex += 1;
        const label = `capture-${captureIndex}`;
        events.push(`${label}-start`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        writeFileSync(path, bytes);
        events.push(`${label}-end`);
      },
      evaluate: async (_fn, payload) => {
        if (payload?.selector) {
          events.push("snapshot");
          return { url: "http://127.0.0.1/read-queue", title: "fixture", selector: payload.selector, truncated: false, nodes: [] };
        }
        throw new Error("unexpected page evaluation");
      },
    },
  });

  try {
    await Promise.all([
      manager.screenshot("read-queue", { timeoutMs: 200 }),
      manager.snapshot("read-queue", { selector: "body" }),
    ]);
    await Promise.all([
      manager.screenshot("read-queue", { timeoutMs: 200 }),
      manager.inspect("read-queue", "#target"),
    ]);

    assert.deepEqual(events, [
      "capture-1-start",
      "capture-1-end",
      "snapshot",
      "capture-2-start",
      "capture-2-end",
      "inspect",
    ]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("full-page capture reaches a stitched fallback when compositor capture fails", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-stitched-"));
  const manager = new BrowserSessionManager({ outputDir });
  const segment = pngBuffer(4, 2);
  const context = cdpContext(async (method) => {
    if (method === "Page.getLayoutMetrics") {
      return { cssContentSize: { x: 0, y: 0, width: 4, height: 6 } };
    }
    throw new Error("CDP full-surface capture exceeded compositor limits");
  });
  const page = mockSession(manager, "stitched", {
    context,
    page: {
      viewportSize: () => ({ width: 4, height: 2 }),
      screenshot: async (options) => {
        if (options.fullPage) throw new Error("Playwright full-page capture timed out");
        if (options.clip) return segment;
        throw new Error("unexpected screenshot request");
      },
    },
  });
  page.context = () => context;

  try {
    const result = await manager.screenshot("stitched", { full: true, timeoutMs: 250 });
    assert.equal(result.captureMode, "stitched-full-page-fallback");
    assert.deepEqual(
      { width: result.image.width, height: result.image.height },
      { width: 4, height: 6 },
    );
    assert.equal(PNG.sync.read(Buffer.from(result.data, "base64")).height, 6);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("persistent auto capture avoids repeated identical Playwright timeouts", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "pursr-capture-persistent-"));
  const bytes = pngBuffer(6, 4);
  let playwrightCalls = 0;
  const manager = new BrowserSessionManager({ outputDir });
  const context = cdpContext(async () => ({ data: bytes.toString("base64") }));
  const page = mockSession(manager, "persistent", {
    context,
    page: {
      screenshot: async () => {
        playwrightCalls += 1;
        throw new Error("Playwright capture timeout");
      },
    },
  });
  page.context = () => context;

  try {
    const results = [];
    for (let index = 0; index < 20; index += 1) {
      results.push(await manager.screenshot("persistent", { timeoutMs: 100 }));
    }
    assert.equal(playwrightCalls, 1);
    assert.equal(results.length, 20);
    assert.ok(results.every((result) => result.image.width === 6 && result.image.height === 4));
    assert.deepEqual(Buffer.from(results[0].data, "base64"), readFileSync(results[0].out));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
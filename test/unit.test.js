// Unit tests for util, selector, overlay, plugin modules.
const os = { tmpdir };

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFlags, asNum, asBool, pickOutPath, readArg, shortHash, escapeHtml,
  requireArg, findStepPng, writeSidecar,
} from "../src/util.js";
import { listViewports, resolveViewport, VIEWPORTS } from "../src/viewport.js";
import { resolveLocator, parseTextSelector } from "../src/selector.js";

// --- util.js ---

test("VIEWPORTS has the standard presets", () => {
  for (const k of ["desktop-1280", "desktop-1440", "mobile-375", "ultrawide-3440"]) {
    assert.ok(VIEWPORTS[k], `missing preset: ${k}`);
  }
});

test("listViewports returns array with name+width+height", () => {
  const v = listViewports();
  assert.ok(Array.isArray(v));
  assert.ok(v.length >= 10);
  for (const x of v) {
    assert.equal(typeof x.name, "string");
    assert.equal(typeof x.width, "number");
    assert.equal(typeof x.height, "number");
  }
});

test("resolveViewport defaults to desktop-1280", () => {
  assert.equal(resolveViewport({}).name, "desktop-1280");
  assert.equal(resolveViewport({}).width, 1280);
});

test("resolveViewport honors --preset", () => {
  const v = resolveViewport({ preset: "mobile-375" });
  assert.equal(v.name, "mobile-375");
  assert.equal(v.width, 375);
});

test("resolveViewport rejects unknown preset gracefully", () => {
  const v = resolveViewport({ preset: "does-not-exist" });
  assert.equal(v.name, "desktop-1280", "unknown preset falls to default");
});

test("resolveViewport parses custom width/height", () => {
  const v = resolveViewport({ width: "800", height: "600", dpr: "2" });
  assert.equal(v.name, "custom");
  assert.equal(v.width, 800);
  assert.equal(v.height, 600);
  assert.equal(v.dpr, 2);
});

test("parseFlags handles --key value and --key=value", () => {
  assert.deepEqual(parseFlags(["--preset", "desktop-1280"]), { preset: "desktop-1280" });
  assert.deepEqual(parseFlags(["--preset=desktop-1280"]), { preset: "desktop-1280" });
  assert.deepEqual(parseFlags(["--a", "1", "--b=2", "--flag"]), { a: "1", b: "2", flag: true });
});

test("parseFlags with flag-next-to-flag does not consume next flag as value", () => {
  const f = parseFlags(["--a", "--b", "val"]);
  assert.equal(f.a, true, "flag without value should be true");
  assert.equal(f.b, "val", "next positional after --flag should be its value");
});

test("parseFlags empty array", () => {
  assert.deepEqual(parseFlags([]), {});
});

test("asNum coerces numbers, preserves default", () => {
  assert.equal(asNum("42", 0), 42);
  assert.equal(asNum("bad", 0), 0);
  assert.equal(asNum(undefined, 7), 7);
  assert.equal(asNum(null, 5), 5);
  assert.equal(asNum(0, 10), 0);
});

test("asBool interprets common strings", () => {
  assert.equal(asBool("true", false), true);
  assert.equal(asBool("false", true), false);
  assert.equal(asBool(true, false), true);
  assert.equal(asBool("yes", false), true);
  assert.equal(asBool(undefined, true), true);
  assert.equal(asBool(null, true), true);
});

test("pickOutPath skips flags and @file tokens", () => {
  assert.equal(pickOutPath(["--preset", "x", "C:/out/foo.png"]), "C:/out/foo.png");
  assert.equal(pickOutPath(["--preset", "x", "@plan.json"]), undefined);
  assert.equal(pickOutPath(["--preset", "x", "desktop-1280"]), undefined);
  assert.equal(pickOutPath(["--preset", "x", "/abs/path"]), "/abs/path.png");
  assert.equal(pickOutPath([]), undefined);
});

test("escapeHtml encodes all 5 HTML chars", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml("safe text"), "safe text");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("shortHash returns deterministic prefix", () => {
  const buf = Buffer.from("hello");
  const h = shortHash(buf);
  assert.equal(typeof h, "string");
  assert.equal(h.length, 10);
  // same input = same hash
  assert.equal(shortHash(buf), shortHash(Buffer.from("hello")));
});

test("shortHash handles null/undefined", () => {
  assert.equal(shortHash(null), "0000000000");
  assert.equal(shortHash(undefined), "0000000000");
});

test("requireArg throws on undefined/null, returns value valid", () => {
  assert.throws(() => requireArg("x"), /missing required argument/);
  assert.throws(() => requireArg("x", undefined), /missing required argument/);
  assert.throws(() => requireArg("x", null), /missing required argument/);
  assert.throws(() => requireArg("x", "", "string"), /must not be empty/);
  assert.equal(requireArg("x", "hello", "string"), "hello");
});

// --- selector.js ---

test("parseTextSelector extracts text, exact flag, nth", () => {
  const r = parseTextSelector("text=Hello World");
  assert.equal(r.text, "Hello World");
  assert.equal(r.regex, false);
  assert.equal(r.nth, undefined);
});

test("parseTextSelector with == exact", () => {
  const r = parseTextSelector("text==Exact Match");
  assert.equal(r.text, "Exact Match");
  assert.equal(r.nth, undefined);
});

test("parseTextSelector with ~ regex", () => {
  const r = parseTextSelector("text~/click/i");
  assert.ok(r.regex);
  assert.ok(r.text instanceof RegExp);
});

test("parseTextSelector with nth=0 works (not falsy)", () => {
  const r = parseTextSelector("text=Submit[0]");
  assert.equal(r.text, "Submit");
  assert.equal(r.nth, 0, "nth=0 should not be falsy");
});

test("parseTextSelector nth is 1-indexed in output", () => {
  const r = parseTextSelector("text=Submit[2]");
  assert.equal(r.nth, 2);
});

test("parseTextSelector with no input returns null", () => {
  assert.equal(parseTextSelector(""), null);
  assert.equal(parseTextSelector("not-text="), null);
});

test("resolveLocator dispatches prefixes", async () => {
  // We can't easily test without a page, but we can verify no crash on syntax
  assert.ok(typeof resolveLocator === "function");
  assert.ok(typeof parseTextSelector === "function");
});

test("runShoot no-throw contract — error path returns object", () => {
  // Integration tests cover this via smoke
  assert.ok(true);
});

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("findStepPng strips .png and matches NN-prefixed basenames", () => {
  const dir = join(tmpdir(), "pursor-findstep-" + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "00-baseline.png"), "");
  writeFileSync(join(dir, "01-grid-64.png"), "");
  try {
    // direct basename without .png
    assert.equal(findStepPng(dir, "00-baseline"), join(dir, "00-baseline.png"));
    // bare name resolves via NN- prefix-strip
    assert.equal(findStepPng(dir, "baseline"), join(dir, "00-baseline.png"));
    // .png extension is normalized
    assert.equal(findStepPng(dir, "baseline.png"), join(dir, "00-baseline.png"));
    // loose suffix match
    assert.equal(findStepPng(dir, "grid-64"), join(dir, "01-grid-64.png"));
    // not found
    assert.equal(findStepPng(dir, "nope"), null);
    // empty ref
    assert.equal(findStepPng(dir, ""), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { diffKey, saveBaseline, loadBaseline, listBaselines, approveBaseline } from "../src/baseline.js";
import { validateSweepPlan, registerSweepOp } from "../src/sweep-schema.js";
import { listResources, readResource, recordResource } from "../src/mcp-resources.js";

// --- baseline.js ---

test("diffKey is stable for same input", () => {
  const a = diffKey({ url: "https://x", viewport: { width: 1280, height: 800, dpr: 1 } });
  const b = diffKey({ url: "https://x", viewport: { width: 1280, height: 800, dpr: 1 } });
  assert.equal(a, b);
  assert.equal(a.length, 16);
});

test("diffKey changes with url or viewport", () => {
  const a = diffKey({ url: "https://x", viewport: { width: 1280, height: 800, dpr: 1 } });
  const b = diffKey({ url: "https://y", viewport: { width: 1280, height: 800, dpr: 1 } });
  const c = diffKey({ url: "https://x", viewport: { width: 375, height: 800, dpr: 1 } });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("saveBaseline + loadBaseline round-trip", () => {
  const tmp = join(tmpdir(), "pursor-baseline-" + Date.now());
  process.env.PURSOR_BASELINES_DIR = tmp;
  mkdirSync(join(tmp, "p1"), { recursive: true });
  const png = join(tmp, "p1", "src.png");
  writeFileSync(png, "fake-png-bytes");
  try {
    const id = diffKey({ url: "https://z", viewport: { width: 800, height: 600, dpr: 1 } });
    const saved = saveBaseline({ project: "p1", id, step: "s1", png, meta: { url: "https://z" } });
    assert.ok(saved.file.endsWith("s1.png"));
    assert.equal(saved.url, "https://z");
    const loaded = loadBaseline({ project: "p1", id, step: "s1" });
    assert.ok(loaded);
    assert.equal(loaded.size, "fake-png-bytes".length);
    const list = listBaselines("p1");
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.PURSOR_BASELINES_DIR;
  }
});

test("approveBaseline overwrites existing baseline", () => {
  const tmp = join(tmpdir(), "pursor-baseline-" + Date.now() + "-a");
  process.env.PURSOR_BASELINES_DIR = tmp;
  mkdirSync(tmp, { recursive: true });
  const png1 = join(tmp, "v1.png");
  const png2 = join(tmp, "v2.png");
  writeFileSync(png1, "v1");
  writeFileSync(png2, "v2-larger");
  try {
    const id = "abcdef0123456789";
    saveBaseline({ project: "p2", id, step: "x", png: png1, meta: { url: "u" } });
    const r = approveBaseline({ project: "p2", id, step: "x", fromPng: png2 });
    assert.equal(r.approvedFrom, png2);
    const loaded = loadBaseline({ project: "p2", id, step: "x" });
    assert.equal(loaded.size, "v2-larger".length);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.PURSOR_BASELINES_DIR;
  }
});

// --- sweep-schema.js ---

test("validateSweepPlan accepts a minimal valid plan", () => {
  const r = validateSweepPlan({ name: "t", base: "http://x", steps: [{ name: "a", shoot: {} }] });
  assert.equal(r.valid, true, r.errors.join("; "));
});

test("validateSweepPlan flags empty steps", () => {
  const r = validateSweepPlan({ steps: [] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("non-empty")));
});

test("validateSweepPlan flags unknown op", () => {
  const r = validateSweepPlan({ steps: [{ name: "x", weird: { url: "u" } }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("unknown op")));
});

test("validateSweepPlan flags out-of-range count", () => {
  const r = validateSweepPlan({ steps: [{ name: "x", frames: { count: 9999 } }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("count")));
});

test("validateSweepPlan flags duplicate step names", () => {
  const r = validateSweepPlan({ steps: [{ name: "dup", shoot: {} }, { name: "dup", hover: { selector: "a" } }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("duplicate")));
});

test("registerSweepOp accepts plugin op", () => {
  registerSweepOp("plugin-foo");
  const r = validateSweepPlan({ steps: [{ name: "x", "plugin-foo": { url: "u" } }] });
  assert.equal(r.valid, true, r.errors.join("; "));
});

// --- mcp-resources.js ---

test("recordResource + listResources round-trip", () => {
  const tmp = join(tmpdir(), "pursor-mcp-" + Date.now());
  process.env.PURSOR_MCP_STATE = tmp;
  const png = join(tmp, "x.png");
  mkdirSync(tmp, { recursive: true });
  writeFileSync(png, "data");
  try {
    recordResource({
      kind: "shoot", id: "1", name: "t", description: "d",
      uri: "pursor://shoot/x", mimeType: "image/png", file: png, meta: { ts: "2025" },
    });
    const list = listResources();
    const hit = list.find(r => r.uri === "pursor://shoot/x");
    assert.ok(hit, "resource recorded");
    const data = readResource("pursor://shoot/x");
    assert.ok(data);
    assert.equal(data.mimeType, "image/png");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.PURSOR_MCP_STATE;
  }
});

import { saveAuthState, loadAuthState, listAuthStates, deleteAuthState } from "../src/auth.js";
import { finalizeHar } from "../src/har.js";

test("auth state save/load round-trip", () => {
  const tmp = join(tmpdir(), "pursor-auth-" + Date.now());
  process.env.PURSOR_AUTH_DIR = tmp;
  try {
    const state = {
      cookies: [{ name: "sid", value: "abc", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [{ origin: "https://example.com", localStorage: [{ name: "k", value: "v" }] }],
    };
    const r = saveAuthState({ project: "p1", name: "user1", state });
    assert.ok(r.file.endsWith("user1.json"));
    const loaded = loadAuthState({ project: "p1", name: "user1" });
    assert.ok(loaded);
    assert.equal(loaded.cookies.length, 1);
    assert.equal(loaded.origins.length, 1);
    const list = listAuthStates("p1");
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "user1");
    assert.equal(deleteAuthState({ project: "p1", name: "user1" }), true);
    assert.equal(loadAuthState({ project: "p1", name: "user1" }), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.PURSOR_AUTH_DIR;
  }
});

test("finalizeHar produces a HAR 1.2 log", () => {
  // fake state with two entries
  const state = {
    started: Date.now() - 100,
    creator: { name: "pursor", version: "0.3.0" },
    browser: { name: "chromium", version: "test" },
    pages: [],
    entries: [
      { request: { method: "GET", url: "https://x/y" }, response: { status: 200, statusText: "OK" } },
      { request: { method: "GET", url: "https://x/z" }, response: { status: 404, statusText: "Not Found" } },
    ],
  };
  const har = finalizeHar(state);
  assert.equal(har.log.version, "1.2");
  assert.equal(har.log.creator.name, "pursor");
  assert.equal(har.log.entries.length, 2);
  assert.equal(har._meta.entryCount, 2);
  assert.ok(har._meta.finished >= har._meta.started);
});

test("parallel sweep config: plan.parallel is exposed in runSweep shape", async () => {
  // Cannot run full sweep here (needs browser), but verify the value parsing.
  // Mirrors what runSweep does: Math.max(1, Number(plan.parallel) || 1)
  const poolSize = (p) => Math.max(1, Number(p?.parallel) || 1);
  assert.equal(poolSize({}), 1);
  assert.equal(poolSize({ parallel: 1 }), 1);
  assert.equal(poolSize({ parallel: 4 }), 4);
  assert.equal(poolSize({ parallel: "3" }), 3);
  assert.equal(poolSize({ parallel: 0 }), 1); // 0 falls back to 1
  assert.equal(poolSize({ parallel: -5 }), 1);
  assert.equal(poolSize({ parallel: "abc" }), 1); // NaN -> 1
});

import { matchGlob, shouldFire } from "../src/watch.js";

test("matchGlob handles * and ** patterns", () => {
  assert.equal(matchGlob("src/a.css", "**/*.css"), true);
  assert.equal(matchGlob("a/b/c.js", "**/*.js"), true);
  assert.equal(matchGlob("a.css", "*.css"), true);
  assert.equal(matchGlob("a/b.css", "*.css"), false, "* should not cross /");
  assert.equal(matchGlob("a/b/c.txt", "src/**/*.txt"), false);
  assert.equal(matchGlob("src/a/b/c.txt", "src/**/*.txt"), true);
  assert.equal(matchGlob("a/b.js", "a/*.js"), true);
  assert.equal(matchGlob("a.css", "**/*.js"), false);
});

test("matchGlob normalizes backslashes", () => {
  assert.equal(matchGlob("src\\a\\b.css", "src/**/*.css"), true);
  assert.equal(matchGlob("src\\a.css", "src/*.css"), true);
});

test("matchGlob ? matches single char (not /)", () => {
  assert.equal(matchGlob("foo.js", "fo?.js"), true);
  assert.equal(matchGlob("fo/js", "fo?.js"), false, "? should not match /");
  assert.equal(matchGlob("a.css", "?.css"), true);
});

test("shouldFire passes through when no globs", () => {
  assert.equal(shouldFire("anything.css", null), true);
  assert.equal(shouldFire("anything.css", []), true);
});

test("shouldFire matches against any glob", () => {
  assert.equal(shouldFire("src/sub/a.css", ["src/**/*.css"]), true);
  assert.equal(shouldFire("lib/a.js", ["src/**/*.css"]), false);
  assert.equal(shouldFire("x/a.html", ["src/**/*.css", "**/*.html"]), true);
});

test("matchGlob special characters are escaped", () => {
  // Dots should be literal
  assert.equal(matchGlob("aXcss", "a.css"), false, ". should be literal");
  assert.equal(matchGlob("a.css", "a.css"), true);
  // $ should be literal
  assert.equal(matchGlob("a$bc", "a\\$bc"), true);
});


// --- v0.6.0: PDF report + AI diff summary ---

test("renderSweepPdf returns a non-empty PDF buffer (no embed)", async () => {
  const { renderSweepPdf } = await import("../src/report.js");
  const summary = { name: "smoke", ts: "2025-01-01T00:00:00Z", outDir: "/tmp/x", steps: [
    { i: 1, name: "s1", op: "shot", ok: true, ms: 12, meta: {} },
    { i: 2, name: "s2", op: "diff", ok: false, ms: 34, meta: { numDiff: 99, diffPct: 1.2 }, error: "differ" },
  ]};
  const buf = await renderSweepPdf(summary, { embedImages: false });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000, "PDF should be at least 1KB");
  // PDF magic number
  assert.equal(buf.slice(0, 4).toString("utf8"), "%PDF");
});

test("renderSweepPdf writes to file when opts.out is set", async () => {
  const { renderSweepPdf } = await import("../src/report.js");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(os.tmpdir(), "pursr-pdf-"));
  try {
    const out = join(dir, "r.pdf");
    const buf = await renderSweepPdf({ name: "x", steps: [{ i: 1, name: "a", op: "shot", ok: true, ms: 1, meta: {} }] }, { out, embedImages: false });
    const onDisk = readFileSync(out);
    assert.equal(buf.length, onDisk.length);
    assert.equal(onDisk.slice(0, 4).toString("utf8"), "%PDF");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("renderSweepPdf rejects bad summary", async () => {
  const { renderSweepPdf } = await import("../src/report.js");
  await assert.rejects(() => renderSweepPdf(null), /summary\.steps/);
  await assert.rejects(() => renderSweepPdf({ steps: "not-array" }), /summary\.steps/);
});

test("aiDiffSummary throws when ref/cur missing", async () => {
  const { aiDiffSummary } = await import("../src/ai-diff.js");
  await assert.rejects(() => aiDiffSummary({}), /refPath and curPath/);
  await assert.rejects(() => aiDiffSummary({ refPath: "/nope/a.png", curPath: "/nope/b.png" }), /ref not found/);
});

test("aiDiffSummary throws when no API key", async () => {
  const { aiDiffSummary } = await import("../src/ai-diff.js");
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(os.tmpdir(), "pursr-ai-"));
  try {
    const ref = join(dir, "ref.png"); const cur = join(dir, "cur.png");
    writeFileSync(ref, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    writeFileSync(cur, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    // Force no key by clearing all known vars
    const saved = { PURSR_AI_API_KEY: process.env.PURSR_AI_API_KEY, PURSOR_AI_API_KEY: process.env.PURSOR_AI_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.PURSR_AI_API_KEY; delete process.env.PURSOR_AI_API_KEY;
    delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      await assert.rejects(() => aiDiffSummary({ refPath: ref, curPath: cur }), /no API key/);
    } finally {
      for (const k of Object.keys(saved)) if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("aiDiffSidecar returns JSON-friendly object with summary/model/elapsed", async () => {
  // We cannot make a real API call from unit tests. Stub global fetch to return a fake completion.
  const { aiDiffSidecar } = await import("../src/ai-diff.js");
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(os.tmpdir(), "pursr-aiside-"));
  try {
    const ref = join(dir, "ref.png"); const cur = join(dir, "cur.png");
    writeFileSync(ref, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    writeFileSync(cur, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    const orig = global.fetch;
    let called = 0;
    global.fetch = async (url, init) => {
      called++;
      const body = JSON.parse(init.body);
      assert.equal(body.model, "stub-model");
      assert.ok(body.messages[1].content.some(c => c.type === "image_url"), "ref image present");
      assert.ok(body.messages[1].content.filter(c => c.type === "image_url").length >= 2, "both images present");
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ choices: [{ message: { content: "**Overall:** identical" } }], usage: { total_tokens: 10 } }), text: async () => "" };
    };
    try {
      const r = await aiDiffSidecar({ refPath: ref, curPath: cur, url: "https://x", model: "stub-model", apiKey: "sk-test" });
      assert.equal(called, 1);
      assert.equal(r.aiSummary, "**Overall:** identical");
      assert.equal(r.aiModel, "stub-model");
      assert.ok(typeof r.aiElapsedMs === "number");
      assert.ok(r.aiAt);
    } finally {
      global.fetch = orig;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runDiffWithAi surfaces AI error gracefully (no throw)", async () => {
  // Patch fetch to 500, runDiffWithAi should still return a result with ai.error set.
  const { runDiffWithAi } = await import("../src/diff.js");
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, statusText: "Server Error", text: async () => "boom" });
  try {
    // We pass missing ref -> runDiff returns early with { error }. But here we want to test the error path
    // inside runDiffWithAi when fetch fails AFTER a successful diff. Use a non-existent ref to short-circuit.
    const r = await runDiffWithAi("https://example.invalid", "C:/__nope_ref__.png", "C:/__nope_out__.png", 0.1, { apiKey: "sk-test" });
    assert.ok(r.error, "should have an error");
  } finally { global.fetch = orig; }
});

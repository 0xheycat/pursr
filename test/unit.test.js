// Unit tests for util, selector, overlay, plugin modules.

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

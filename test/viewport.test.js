// Minimal smoke test: CLI parses correctly, viewports output matches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listViewports, resolveViewport, VIEWPORTS } from "../src/viewport.js";
import { parseFlags, asNum, asBool, pickOutPath, readArg } from "../src/util.js";

test("VIEWPORTS has the standard presets", () => {
  for (const k of ["desktop-1280", "desktop-1440", "mobile-375", "ultrawide-3440"]) {
    assert.ok(VIEWPORTS[k], `missing preset: ${k}`);
  }
});

test("listViewports returns array", () => {
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
  const v = resolveViewport({});
  assert.equal(v.name, "desktop-1280");
  assert.equal(v.width, 1280);
});

test("resolveViewport honors --preset", () => {
  const v = resolveViewport({ preset: "mobile-375" });
  assert.equal(v.name, "mobile-375");
  assert.equal(v.width, 375);
});

test("parseFlags handles --key value and --key=value", () => {
  assert.deepEqual(parseFlags(["--preset", "desktop-1280"]), { preset: "desktop-1280" });
  assert.deepEqual(parseFlags(["--preset=desktop-1280"]), { preset: "desktop-1280" });
  assert.deepEqual(parseFlags(["--a", "1", "--b=2", "--flag"]), { a: "1", b: "2", flag: true });
});

test("asNum coerces numbers, preserves default", () => {
  assert.equal(asNum("42", 0), 42);
  assert.equal(asNum("bad", 0), 0);
  assert.equal(asNum(undefined, 7), 7);
});

test("asBool interprets common strings", () => {
  assert.equal(asBool("true", false), true);
  assert.equal(asBool("false", true), false);
  assert.equal(asBool(true, false), true);
  assert.equal(asBool("yes", false), true);
});

test("pickOutPath skips flags and @file tokens", () => {
  assert.equal(pickOutPath(["--preset", "x", "C:/out/foo.png"]), "C:/out/foo.png");
  assert.equal(pickOutPath(["--preset", "x", "@plan.json"]), undefined);
  assert.equal(pickOutPath(["--preset", "x", "desktop-1280"]), undefined);
  assert.equal(pickOutPath(["--preset", "x", "/abs/path"]), "/abs/path.png");
});
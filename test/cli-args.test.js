import test from "node:test";
import assert from "node:assert/strict";
import { filePathArg, parseCommandArgs } from "../src/cli-args.js";

test("parseCommandArgs separates flags from positionals regardless of order", () => {
  const parsed = parseCommandArgs(["--preset", "desktop-1280", "https://example.com", "#go", "--out", "shot.png"]);
  assert.deepEqual(parsed.positionals, ["https://example.com", "#go"]);
  assert.deepEqual(parsed.flags, { preset: "desktop-1280", out: "shot.png" });
});

test("parseCommandArgs does not consume a positional after boolean flags", () => {
  const parsed = parseCommandArgs(["--full", "https://example.com", "--no-animation"]);
  assert.deepEqual(parsed.positionals, ["https://example.com"]);
  assert.deepEqual(parsed.flags, { full: true, "no-animation": true });
});

test("filePathArg accepts regular and @-prefixed paths", () => {
  assert.equal(filePathArg("plan.json"), "plan.json");
  assert.equal(filePathArg("@plan.json"), "plan.json");
});

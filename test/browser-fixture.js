import { test } from "node:test";
import { resolveBrowserExecutable } from "../src/runway.js";

export const browserExecutable = await resolveBrowserExecutable();
export const browserAvailable = Boolean(browserExecutable);
export const browserTest = browserAvailable ? test : test.skip;
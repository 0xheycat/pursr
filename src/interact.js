// click, type, wait, seq — interaction primitives.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS, WAIT_DEFAULT_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";
import { requireArg } from "./util.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function ensureScreenshotDir(out) {
  if (out) mkdirSync(dirname(out), { recursive: true });
}

export async function runClick(url, selector, out, flags = {}) {
  requireArg("url", url, "string");
  requireArg("selector", selector, "string");
  const browser = await launch();
  try {
    const page = await newPage(browser, resolveViewport(flags));
    const r = await gotoOrThrow(page, url); await settle(page);
    const loc = await resolveLocator(page, selector);
    await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
    await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
    await settle(page);
    if (out) { ensureScreenshotDir(out); await page.screenshot({ path: out, fullPage: false }); }
    return { ...r, url, out, selector, clicked: true };
  } finally { try { await browser.close(); } catch {} }
}

export async function runType(url, selector, text, out, flags = {}) {
  requireArg("url", url, "string");
  requireArg("selector", selector, "string");
  const browser = await launch();
  try {
    const page = await newPage(browser, resolveViewport(flags));
    const r = await gotoOrThrow(page, url); await settle(page);
    const loc = await resolveLocator(page, selector);
    await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
    await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
    await page.keyboard.type(String(text ?? ""), { delay: 10 });
    await settle(page);
    if (out) { ensureScreenshotDir(out); await page.screenshot({ path: out, fullPage: false }); }
    return { ...r, url, out, selector, text, typed: true };
  } finally { try { await browser.close(); } catch {} }
}

export async function runWait(url, selector, timeoutMs, flags = {}) {
  requireArg("url", url, "string");
  requireArg("selector", selector, "string");
  const browser = await launch();
  try {
    const page = await newPage(browser, resolveViewport(flags));
    const r = await gotoOrThrow(page, url);
    const loc = await resolveLocator(page, selector);
    const t = timeoutMs || WAIT_DEFAULT_TIMEOUT_MS;
    try {
      await loc.first().waitFor({ state: "visible", timeout: t });
      return { ...r, url, selector, found: true, timeoutMs: t };
    } catch {
      return { ...r, url, selector, found: false, timeoutMs: t };
    }
  } finally { try { await browser.close(); } catch {} }
}

export async function runSeq(url, actionsJson, out, flags = {}) {
  requireArg("url", url, "string");
  let actions;
  try { actions = JSON.parse(actionsJson); }
  catch (e) { throw new Error(`invalid actions JSON: ${e.message}`, { cause: e }); }
  if (!Array.isArray(actions)) throw new Error("actions must be a JSON array");
  if (!actions.length) throw new Error("actions array is empty");
  const browser = await launch();
  try {
    const page = await newPage(browser, resolveViewport(flags));
    const r = await gotoOrThrow(page, url); await settle(page);
    const trace = [];
    let failed = false;
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i] || {};
      const step = { i, op: a.op };
      try {
        switch (a.op) {
          case "click": {
            const loc = await resolveLocator(page, a.selector);
            await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
            await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
            step.selector = a.selector; break;
          }
          case "type": {
            const loc = await resolveLocator(page, a.selector);
            await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
            await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
            await page.keyboard.type(String(a.text ?? ""), { delay: 10 });
            step.selector = a.selector; step.text = a.text; break;
          }
          case "wait": {
            const t = a.timeoutMs ? Number(a.timeoutMs) : WAIT_DEFAULT_TIMEOUT_MS;
            const loc = await resolveLocator(page, a.selector);
            await loc.first().waitFor({ state: "visible", timeout: t });
            step.selector = a.selector; step.timeoutMs = t; break;
          }
          case "eval": { step.result = await page.evaluate(String(a.js ?? "")); break; }
          case "shot": {
            await page.screenshot({ path: a.out, fullPage: !!a.fullPage });
            step.out = a.out; step.fullPage = !!a.fullPage; break;
          }
          case "scroll": {
            const vp = page.viewportSize();
            await page.mouse.move((vp?.width || 640) / 2, (vp?.height || 400) / 2);
            await page.mouse.wheel(a.deltaX || 0, a.deltaY || 0);
            step.deltaX = a.deltaX; step.deltaY = a.deltaY; break;
          }
          case "navigate": { await gotoOrThrow(page, a.url); step.url = a.url; break; }
          case "press": {
            // a.key can be a single key ("Escape") or comma-separated ("Tab,Enter")
            const raw = String(a.key ?? "").trim();
            if (!raw) throw new Error("press: missing key");
            const keys = raw.split(",").map(k => k.trim()).filter(Boolean);
            for (const k of keys) await page.keyboard.press(k);
            step.key = raw; step.count = keys.length; break;
          }
          case "sleep": { await page.waitForTimeout(Number(a.ms ?? 1000)); step.ms = a.ms; break; }
          case "hover": {
            const loc = await resolveLocator(page, a.selector);
            await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
            await loc.first().hover({ timeout: CLICK_TIMEOUT_MS });
            step.selector = a.selector; break;
          }
          default: throw new Error(`unknown op: ${a.op}`);
        }
        if (a.settleMs !== undefined) await page.waitForTimeout(Number(a.settleMs));
        else await settle(page);
        step.ok = true;
      } catch (e) {
        step.ok = false; step.error = e.message; failed = true;
      }
      trace.push(step);
      if (failed) break;
    }
    if (out) { ensureScreenshotDir(out); await page.screenshot({ path: out, fullPage: false }); }
    return { ...r, url, out, steps: trace, failed };
  } finally { try { await browser.close(); } catch {} }
}

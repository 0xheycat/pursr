// click, type, wait, seq — interaction primitives.

import { launch, newPage } from "./runway.js";
import { DEFAULT_VIEWPORT } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS, WAIT_DEFAULT_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";

export async function runClick(url, selector, out) {
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url); await settle(page);
    const loc = await resolveLocator(page, selector);
    await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
    await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
    await settle(page);
    if (out) await page.screenshot({ path: out, fullPage: false });
    return { ...r, url, out, selector, clicked: true };
  } finally { await browser.close(); }
}

export async function runType(url, selector, text, out) {
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url); await settle(page);
    const loc = await resolveLocator(page, selector);
    await loc.first().waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
    await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
    await page.keyboard.type(String(text ?? ""), { delay: 10 });
    await settle(page);
    if (out) await page.screenshot({ path: out, fullPage: false });
    return { ...r, url, out, selector, text, typed: true };
  } finally { await browser.close(); }
}

export async function runWait(url, selector, timeoutMs) {
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url);
    const loc = await resolveLocator(page, selector);
    await loc.first().waitFor({ state: "visible", timeout: timeoutMs || WAIT_DEFAULT_TIMEOUT_MS });
    return { ...r, url, selector, found: true, timeoutMs: timeoutMs || WAIT_DEFAULT_TIMEOUT_MS };
  } finally { await browser.close(); }
}

export async function runSeq(url, actionsJson, out) {
  let actions;
  try { actions = JSON.parse(actionsJson); }
  catch (e) { throw new Error(`invalid actions JSON: ${e.message}`); }
  if (!Array.isArray(actions)) throw new Error("actions must be a JSON array");
  const browser = await launch();
  try {
    const page = await newPage(browser, DEFAULT_VIEWPORT);
    const r = await gotoOrThrow(page, url); await settle(page);
    const trace = [];
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
            await page.mouse.move(640, 400);
            await page.mouse.wheel(a.x || 0, a.y || 0);
            step.x = a.x; step.y = a.y; break;
          }
          case "navigate": { await gotoOrThrow(page, a.url); step.url = a.url; break; }
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
        step.ok = false; step.error = e.message;
        trace.push(step);
        throw new Error(`step ${i} (${a.op}) failed: ${e.message}`);
      }
      trace.push(step);
    }
    if (out) await page.screenshot({ path: out, fullPage: false });
    return { ...r, url, out, steps: trace };
  } finally { await browser.close(); }
}
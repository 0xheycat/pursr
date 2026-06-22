// Persistent browser sessions for agent-driven visual QA.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS, WAIT_DEFAULT_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";

const MAX_DIAGNOSTICS = 250;
const MAX_ACTIONS = 50;

function cleanId(value) {
  const id = String(value || "").trim();
  if (!id) return `session-${Date.now().toString(36)}`;
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) throw new Error("sessionId must use only letters, numbers, dot, underscore, or dash");
  return id;
}

function pushCapped(list, value) {
  list.push(value);
  if (list.length > MAX_DIAGNOSTICS) list.splice(0, list.length - MAX_DIAGNOSTICS);
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", (msg) => pushCapped(diagnostics.console, { type: msg.type(), text: msg.text(), ts: new Date().toISOString() }));
  page.on("pageerror", (error) => pushCapped(diagnostics.errors, { message: error.message, stack: error.stack || null, ts: new Date().toISOString() }));
  page.on("requestfailed", (request) => pushCapped(diagnostics.requests, {
    method: request.method(), url: request.url(), failure: request.failure()?.errorText || "failed", ts: new Date().toISOString(),
  }));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    pushCapped(diagnostics.responses, {
      status: response.status(), method: response.request().method(), url: response.url(), ts: new Date().toISOString(),
    });
  });
}

export class BrowserSessionManager {
  constructor({ launchBrowser = launch, outputDir = process.cwd() } = {}) {
    this.launchBrowser = launchBrowser;
    this.outputDir = outputDir;
    this.sessions = new Map();
  }

  get size() { return this.sessions.size; }

  get(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) throw new Error(`unknown session: ${sessionId}`);
    return session;
  }

  list() {
    return [...this.sessions.values()].map(({ id, page, viewport, createdAt }) => ({ sessionId: id, url: page.url(), viewport, createdAt }));
  }

  async open({ sessionId, url, flags = {}, storageState } = {}) {
    if (!url) throw new Error("url is required");
    const id = cleanId(sessionId);
    if (this.sessions.has(id)) await this.close(id);
    const browser = await this.launchBrowser();
    try {
      const viewport = resolveViewport(flags);
      const page = await newPage(browser, viewport, { storageState });
      const diagnostics = { console: [], errors: [], requests: [], responses: [] };
      attachDiagnostics(page, diagnostics);
      const nav = await gotoOrThrow(page, url, { timeoutMs: flags.timeoutMs });
      await settle(page);
      const session = { id, browser, page, context: page._pursrContext, viewport, diagnostics, createdAt: new Date().toISOString() };
      this.sessions.set(id, session);
      return { sessionId: id, url: page.url(), title: await page.title(), viewport, status: nav.status, createdAt: session.createdAt };
    } catch (error) {
      try { await browser.close(); } catch {}
      throw error;
    }
  }

  async snapshot(sessionId, { selector = "body", maxNodes = 250, includeStyles = true } = {}) {
    const { page } = this.get(sessionId);
    const limit = Math.max(1, Math.min(1000, Number(maxNodes) || 250));
    return await page.evaluate(({ selector, limit, includeStyles }) => {
      const roots = [...document.querySelectorAll(selector)];
      const elements = roots.flatMap((root) => [root, ...root.querySelectorAll("*")]);
      const nodes = [];
      for (const el of elements) {
        if (nodes.length >= limit) break;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;
        const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160) || null;
        const item = {
          node: nodes.length + 1, tag: el.tagName.toLowerCase(), id: el.id || null,
          role: el.getAttribute("role") || null,
          name: el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || text,
          text, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          state: { disabled: "disabled" in el ? !!el.disabled : undefined, checked: "checked" in el ? !!el.checked : undefined, expanded: el.getAttribute("aria-expanded") },
        };
        if (includeStyles) item.style = {
          display: style.display, position: style.position, zIndex: style.zIndex,
          overflow: `${style.overflowX} ${style.overflowY}`, opacity: style.opacity,
          color: style.color, backgroundColor: style.backgroundColor,
          font: `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`,
          transform: style.transform, boxShadow: style.boxShadow,
        };
        nodes.push(item);
      }
      return { url: location.href, title: document.title, selector, truncated: elements.length > limit, nodes };
    }, { selector, limit, includeStyles: includeStyles !== false });
  }

  async inspect(sessionId, selector) {
    if (!selector) throw new Error("selector is required");
    const { page } = this.get(sessionId);
    const locator = await resolveLocator(page, selector);
    await locator.first().waitFor({ state: "attached", timeout: CLICK_TIMEOUT_MS });
    return await locator.first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const ancestors = [];
      for (let node = el.parentElement; node && ancestors.length < 6; node = node.parentElement) {
        const s = getComputedStyle(node);
        ancestors.push({ tag: node.tagName.toLowerCase(), id: node.id || null, position: s.position, overflow: `${s.overflowX} ${s.overflowY}`, zIndex: s.zIndex, transform: s.transform });
      }
      const computedStyle = {};
      for (const key of ["display","position","inset","width","height","margin","padding","gap","overflow","opacity","visibility","zIndex","transform","transformOrigin","color","background","border","borderRadius","boxShadow","fontFamily","fontSize","fontWeight","lineHeight","textAlign","objectFit","pointerEvents"]) computedStyle[key] = style[key];
      return { tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 2000), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, computedStyle, ancestors };
    });
  }

  async act(sessionId, actions = []) {
    if (!Array.isArray(actions) || !actions.length) throw new Error("actions must be a non-empty array");
    if (actions.length > MAX_ACTIONS) throw new Error(`actions cannot exceed ${MAX_ACTIONS}`);
    const { page } = this.get(sessionId);
    const trace = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i] || {};
      const op = action.type || action.op;
      const step = { index: i, type: op };
      try {
        if (["click", "hover", "fill", "type", "check", "select"].includes(op)) {
          const locator = await resolveLocator(page, action.selector);
          await locator.first().waitFor({ state: "visible", timeout: action.timeoutMs || CLICK_TIMEOUT_MS });
          if (op === "click") await locator.first().click();
          else if (op === "hover") await locator.first().hover();
          else if (op === "fill") await locator.first().fill(String(action.text ?? action.value ?? ""));
          else if (op === "type") await locator.first().pressSequentially(String(action.text ?? ""), { delay: action.delayMs || 10 });
          else if (op === "check") await locator.first().setChecked(action.checked !== false);
          else await locator.first().selectOption(action.value);
          step.selector = action.selector;
        } else if (op === "press") await page.keyboard.press(String(action.key));
        else if (op === "scroll") await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0);
        else if (op === "wait") await (await resolveLocator(page, action.selector)).first().waitFor({ state: action.state || "visible", timeout: action.timeoutMs || WAIT_DEFAULT_TIMEOUT_MS });
        else if (op === "sleep") await page.waitForTimeout(Math.max(0, Number(action.ms) || 0));
        else if (op === "navigate") await gotoOrThrow(page, action.url, { timeoutMs: action.timeoutMs });
        else if (op === "reload") await page.reload({ waitUntil: "domcontentloaded" });
        else if (op === "eval") step.result = await page.evaluate(String(action.js || ""));
        else throw new Error(`unknown action type: ${op}`);
        if (action.settleMs) await page.waitForTimeout(Number(action.settleMs));
        step.ok = true;
      } catch (error) {
        step.ok = false; step.error = error.message; trace.push(step); break;
      }
      trace.push(step);
    }
    return { sessionId, url: page.url(), title: await page.title(), trace, failed: trace.some((step) => !step.ok) };
  }

  async screenshot(sessionId, { out, full = false, selector } = {}) {
    const { page } = this.get(sessionId);
    const file = out || join(this.outputDir, `pursr-${sessionId}-${Date.now()}.png`);
    mkdirSync(dirname(file), { recursive: true });
    if (selector) {
      const locator = await resolveLocator(page, selector);
      await locator.first().screenshot({ path: file });
    } else await page.screenshot({ path: file, fullPage: !!full });
    return { sessionId, out: file, url: page.url(), data: readFileSync(file).toString("base64"), mimeType: "image/png" };
  }

  diagnostics(sessionId, { clear = false } = {}) {
    const session = this.get(sessionId);
    const result = JSON.parse(JSON.stringify(session.diagnostics));
    if (clear) {
      session.diagnostics.console.length = 0;
      session.diagnostics.errors.length = 0;
      session.diagnostics.requests.length = 0;
      session.diagnostics.responses.length = 0;
    }
    return { sessionId, ...result };
  }

  async close(sessionId) {
    const id = String(sessionId || "");
    const session = this.sessions.get(id);
    if (!session) return { sessionId: id, closed: false };
    this.sessions.delete(id);
    try { await session.browser.close(); } catch {}
    return { sessionId: id, closed: true };
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}

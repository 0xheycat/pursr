// Persistent browser sessions for agent-driven visual QA.

import { mkdirSync } from "node:fs";
import { connectOverCDP, launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle, CLICK_TIMEOUT_MS, WAIT_DEFAULT_TIMEOUT_MS } from "./overlays.js";
import { resolveLocator } from "./selector.js";
import { captureScreenshot } from "./capture.js";
import {
  clearVisualAnnotations,
  highlightVisualTarget,
  installVisualOperator,
  markVisualClick,
  moveVisualCursor,
  visualPointForLocator,
} from "./visual-operator.js";

const MAX_DIAGNOSTICS = 250;
const MAX_ACTIONS = 50;
const PLAYWRIGHT_REPROBE_AFTER_CDP_SUCCESSES = 20;

function createCaptureHealth() {
  return {
    playwright: {
      status: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      cdpSuccessesSinceFailure: 0,
    },
    cdp: { status: "unknown", consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null },
  };
}

function captureAttempts(value) {
  return Array.isArray(value?.attempts) ? value.attempts : [];
}

function updateCaptureHealth(session, value) {
  const now = new Date().toISOString();
  for (const attempt of captureAttempts(value)) {
    if (attempt.strategy === "playwright") {
      const state = session.captureHealth.playwright;
      if (attempt.status === "success") {
        state.status = "healthy";
        state.consecutiveFailures = 0;
        state.lastSuccessAt = now;
        state.cdpSuccessesSinceFailure = 0;
      } else {
        state.status = "degraded";
        state.consecutiveFailures += 1;
        state.lastFailureAt = now;
        state.cdpSuccessesSinceFailure = 0;
      }
      continue;
    }
    if (attempt.strategy !== "cdp") continue;
    const state = session.captureHealth.cdp;
    if (attempt.status === "success") {
      state.status = "healthy";
      state.consecutiveFailures = 0;
      state.lastSuccessAt = now;
      if (session.captureHealth.playwright.status === "degraded") {
        session.captureHealth.playwright.cdpSuccessesSinceFailure += 1;
      }
    } else {
      state.status = "degraded";
      state.consecutiveFailures += 1;
      state.lastFailureAt = now;
    }
  }
}
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

function normalizedTimeout(value, fallback) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 0 ? timeout : fallback;
}

function timeoutFailure(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = "BROWSER_OPERATION_TIMEOUT";
  return error;
}

async function runWithDeadline(label, timeoutMs, operation) {
  if (timeoutMs === undefined || timeoutMs === null) return await operation();
  const timeout = normalizedTimeout(timeoutMs, WAIT_DEFAULT_TIMEOUT_MS);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutFailure(label, timeout)), Math.max(1, timeout));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safePageUrl(page) {
  try {
    return page.url?.() || null;
  } catch {
    return null;
  }
}

async function safePageTitle(page, timeoutMs = 25) {
  try {
    return await runWithDeadline("page title read", timeoutMs, () => page.title());
  } catch {
    return null;
  }
}

async function safePageMetadata(page) {
  return {
    url: safePageUrl(page),
    title: await safePageTitle(page),
  };
}

async function interruptPageExecution(page, timeoutMs = 1_500) {
  const context = page.context?.();
  if (!context?.newCDPSession) return false;
  let session;
  try {
    session = await runWithDeadline(
      "CDP recovery session",
      timeoutMs,
      () => context.newCDPSession(page),
    );
    await runWithDeadline(
      "CDP execution interrupt",
      timeoutMs,
      () => session.send("Runtime.terminateExecution"),
    );
    return true;
  } catch {
    return false;
  } finally {
    Promise.resolve(session?.detach?.()).catch(() => {});
  }
}

async function evaluateAction(page, source, timeoutMs) {
  const timeout = normalizedTimeout(timeoutMs, WAIT_DEFAULT_TIMEOUT_MS);
  let timer;
  try {
    return await Promise.race([
      page.evaluate(source),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(timeoutFailure("eval action", timeout)),
          Math.max(1, timeout),
        );
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    if (error?.code === "BROWSER_OPERATION_TIMEOUT") {
      Promise.resolve(interruptPageExecution(page)).catch(() => {});
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function forcedPointerEvent(op) {
  return {
    eventType: op === "doubleClick" ? "dblclick" : "click",
    detail: op === "doubleClick" ? 2 : 1,
  };
}

async function dispatchForcedPointerAction(locator, op, timeout) {
  const { eventType, detail } = forcedPointerEvent(op);
  await locator.dispatchEvent(eventType, {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail,
    button: 0,
  }, { timeout });
  return `dom-${eventType}`;
}

async function dispatchForcedPointerActionInPage(page, selector, op) {
  const { eventType, detail } = forcedPointerEvent(op);
  await page.evaluate(({ selector: cssSelector, eventType: type, detail: clickCount }) => {
    let element;
    try {
      element = document.querySelector(cssSelector);
    } catch {
      throw new Error(`forced DOM dispatch requires a CSS selector: ${cssSelector}`);
    }
    if (!element) throw new Error(`forced DOM dispatch selector not found: ${cssSelector}`);
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: clickCount,
      button: 0,
    }));
  }, { selector, eventType, detail });
  return `dom-${eventType}`;
}

async function settleWithin(task, timeoutMs, label, warnings) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    warnings.push(error?.message || String(error));
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  constructor({
    launchBrowser = launch,
    connectBrowser = connectOverCDP,
    outputDir = process.cwd(),
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
  } = {}) {
    this.launchBrowser = launchBrowser;
    this.connectBrowser = connectBrowser;
    this.outputDir = outputDir;
    this.closeTimeoutMs = normalizedTimeout(closeTimeoutMs, DEFAULT_CLOSE_TIMEOUT_MS);
    this.sessions = new Map();
  }

  get size() { return this.sessions.size; }

  get(sessionId, { allowClosing = false } = {}) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) throw new Error(`unknown session: ${sessionId}`);
    if (!session.captureHealth) session.captureHealth = createCaptureHealth();
    if (!session.operationTail) session.operationTail = Promise.resolve();
    if (session.closing && !allowClosing) throw new Error(`session is closing: ${sessionId}`);
    return session;
  }

  _enqueueSession(session, operation, { kind = "operation", timeoutMs } = {}) {
    const previous = session.operationTail || Promise.resolve();
    session.queueDepth = Number(session.queueDepth || 0) + 1;
    const task = previous.catch(() => {}).then(async () => {
      session.queueDepth = Math.max(0, Number(session.queueDepth || 0) - 1);
      const startedAt = new Date().toISOString();
      session.activeOperation = { kind, startedAt, timeoutMs: timeoutMs ?? null };
      try {
        return await runWithDeadline(`browser ${kind} operation`, timeoutMs, operation);
      } catch (error) {
        if (error?.code === "BROWSER_OPERATION_TIMEOUT" || /timed out|timeout/i.test(error?.message || "")) {
          session.recoveryRequired = true;
          Promise.resolve(interruptPageExecution(session.page)).then((recovered) => {
            if (recovered) session.recoveryRequired = false;
          }).catch(() => {});
        }
        throw error;
      } finally {
        session.activeOperation = null;
      }
    });
    session.operationTail = task.then(() => undefined, () => undefined);
    return task;
  }

  _enqueue(sessionId, operation, options = {}) {
    const session = this.get(sessionId);
    return this._enqueueSession(session, () => operation(session), options);
  }

  list() {
    return [...this.sessions.values()].map((session) => ({
      sessionId: session.id,
      url: safePageUrl(session.page),
      viewport: session.viewport,
      mode: session.mode,
      visual: session.visual,
      createdAt: session.createdAt,
      closing: session.closing === true,
      activeOperation: session.activeOperation || null,
      queueDepth: Number(session.queueDepth || 0),
      recoveryRequired: session.recoveryRequired === true,
    }));
  }

  status(sessionId) {
    const session = this.get(sessionId, { allowClosing: true });
    return this.list().find((entry) => entry.sessionId === session.id);
  }

  async open({ sessionId, url, flags = {}, storageState } = {}) {
    if (!url) throw new Error("url is required");
    const id = cleanId(sessionId);
    if (this.sessions.has(id)) await this.close(id);
    const mode = flags.mode || (flags.cdpUrl ? "cdp" : flags.visible ? "visible" : "headless");
    if (!new Set(["headless", "visible", "cdp"]).has(mode)) throw new Error("mode must be headless, visible, or cdp");
    const visual = flags.visual === true || mode === "visible";
    const recordVideoDir = flags.recordVideoDir || null;
    if (recordVideoDir && mode === "cdp") throw new Error("video recording is not available in CDP mode; use visible or headless mode");
    if (recordVideoDir) mkdirSync(recordVideoDir, { recursive: true });
    const operatorOptions = { color: flags.operatorColor || "#ff2ea6" };
    const browser = mode === "cdp"
      ? await this.connectBrowser(flags.cdpUrl, { timeoutMs: flags.timeoutMs })
      : await this.launchBrowser({ headless: mode !== "visible", slowMo: flags.slowMo });
    try {
      const viewport = resolveViewport(flags);
      const context = mode === "cdp" ? browser.contexts()[0] : null;
      if (mode === "cdp" && !context) throw new Error("CDP browser has no default context");
      const page = await newPage(browser, viewport, { storageState, context, recordVideoDir });
      const diagnostics = { console: [], errors: [], requests: [], responses: [] };
      attachDiagnostics(page, diagnostics);
      if (visual) page.on("domcontentloaded", () => installVisualOperator(page, operatorOptions).catch(() => {}));
      const nav = await gotoOrThrow(page, url, { timeoutMs: flags.timeoutMs });
      await settle(page);
      if (visual) await installVisualOperator(page, operatorOptions);
      const session = {
        id, browser, page, context: page._pursrContext, viewport, mode, visual,
        operatorOptions, diagnostics, video: page.video?.() || null,
        createdAt: new Date().toISOString(),
      };
      this.sessions.set(id, session);
      return { sessionId: id, url: page.url(), title: await page.title(), viewport, mode, visual, status: nav.status, createdAt: session.createdAt };
    } catch (error) {
      try { await browser.close(); } catch {}
      throw error;
    }
  }

  async _snapshot(sessionId, { selector = "body", maxNodes = 250, includeStyles = true } = {}) {
    const { page } = this.get(sessionId, { allowClosing: true });
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

  async snapshot(sessionId, options = {}) {
    return await this._enqueue(sessionId, () => this._snapshot(sessionId, options));
  }

  async _inspect(sessionId, selector) {
    if (!selector) throw new Error("selector is required");
    const { page } = this.get(sessionId, { allowClosing: true });
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

  async inspect(sessionId, selector) {
    return await this._enqueue(sessionId, () => this._inspect(sessionId, selector));
  }

  async _act(sessionId, actions = [], options = {}) {
    if (!Array.isArray(actions) || !actions.length) throw new Error("actions must be a non-empty array");
    if (actions.length > MAX_ACTIONS) throw new Error(`actions cannot exceed ${MAX_ACTIONS}`);
    const defaultActionTimeoutMs = options.timeoutMs === undefined
      ? undefined
      : normalizedTimeout(options.timeoutMs, WAIT_DEFAULT_TIMEOUT_MS);
    const session = this.get(sessionId, { allowClosing: true });
    const { page, visual, operatorOptions } = session;
    const trace = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i] || {};
      const op = action.type || action.op;
      const step = { index: i, type: op };
      try {
        if (["click", "doubleClick", "hover", "fill", "type", "check", "select"].includes(op) && action.selector) {
          const locator = await resolveLocator(page, action.selector);
          const target = locator.first();
          const timeout = normalizedTimeout(
            action.timeoutMs,
            defaultActionTimeoutMs ?? CLICK_TIMEOUT_MS,
          );
          const force = action.force === true;
          let waitError = null;
          try {
            await target.waitFor({ state: force ? "attached" : "visible", timeout });
          } catch (error) {
            if (!force) throw error;
            waitError = error;
          }
          let point = null;
          if (visual && !waitError) {
            point = await visualPointForLocator(target);
            await moveVisualCursor(page, point.x, point.y, { ...operatorOptions, durationMs: action.durationMs });
            await highlightVisualTarget(page, point.rect, { ...operatorOptions, color: action.color, label: action.label || `${op}: ${action.selector}` });
            step.cursor = { x: Math.round(point.x), y: Math.round(point.y) };
          }
          const actionOptions = { timeout, ...(force ? { force: true } : {}) };
          if (op === "click" || op === "doubleClick") {
            if (waitError) {
              step.playwrightError = waitError?.message || String(waitError);
              step.actionMode = await dispatchForcedPointerActionInPage(page, action.selector, op);
            } else try {
              await target[op === "doubleClick" ? "dblclick" : "click"](actionOptions);
              step.actionMode = "playwright";
            } catch (error) {
              if (!force) throw error;
              step.playwrightError = error?.message || String(error);
              step.actionMode = await dispatchForcedPointerAction(target, op, timeout);
            }
          }
          else if (op === "hover") await locator.first().hover(actionOptions);
          else if (op === "fill") await locator.first().fill(String(action.text ?? action.value ?? ""), actionOptions);
          else if (op === "type") await locator.first().pressSequentially(String(action.text ?? ""), { delay: action.delayMs || 10, timeout });
          else if (op === "check") await locator.first().setChecked(action.checked !== false, actionOptions);
          else await locator.first().selectOption(action.value, actionOptions);
          if (visual && ["click", "doubleClick"].includes(op) && point) await markVisualClick(page, point.x, point.y, { ...operatorOptions, color: action.color });
          step.selector = action.selector;
        } else if (["click", "doubleClick"].includes(op) && Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
          const x = Number(action.x), y = Number(action.y);
          if (visual) await moveVisualCursor(page, x, y, { ...operatorOptions, durationMs: action.durationMs });
          await page.mouse[op === "doubleClick" ? "dblclick" : "click"](x, y, { button: action.button || "left" });
          if (visual) await markVisualClick(page, x, y, { ...operatorOptions, color: action.color });
          step.cursor = { x: Math.round(x), y: Math.round(y) };
        } else if (op === "drag") {
          const start = action.fromSelector
            ? await visualPointForLocator((await resolveLocator(page, action.fromSelector)).first())
            : { x: Number(action.fromX), y: Number(action.fromY) };
          const end = action.toSelector
            ? await visualPointForLocator((await resolveLocator(page, action.toSelector)).first())
            : { x: Number(action.toX), y: Number(action.toY) };
          if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error("drag requires from/to coordinates or selectors");
          if (visual) await moveVisualCursor(page, start.x, start.y, { ...operatorOptions, durationMs: action.durationMs });
          await page.mouse.move(start.x, start.y);
          await page.mouse.down({ button: action.button || "left" });
          const steps = Math.max(1, Math.min(100, Number(action.steps) || 20));
          await page.mouse.move(end.x, end.y, { steps });
          await page.mouse.up({ button: action.button || "left" });
          if (visual) {
            await moveVisualCursor(page, end.x, end.y, { ...operatorOptions, durationMs: 0 });
            await markVisualClick(page, end.x, end.y, { ...operatorOptions, color: action.color });
          }
          step.cursor = { x: Math.round(end.x), y: Math.round(end.y) };
        } else if (op === "press") await page.keyboard.press(String(action.key));
        else if (op === "keyDown") await page.keyboard.down(String(action.key));
        else if (op === "keyUp") await page.keyboard.up(String(action.key));
        else if (op === "scroll") await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0);
        else if (op === "wait") await (await resolveLocator(page, action.selector)).first().waitFor({
          state: action.state || "visible",
          timeout: normalizedTimeout(
            action.timeoutMs,
            defaultActionTimeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS,
          ),
        });
        else if (op === "sleep") await page.waitForTimeout(Math.max(0, Number(action.ms) || 0));
        else if (op === "navigate") {
          await gotoOrThrow(page, action.url, {
            timeoutMs: normalizedTimeout(
              action.timeoutMs,
              defaultActionTimeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS,
            ),
          });
          if (visual) await installVisualOperator(page, operatorOptions);
        } else if (op === "reload") {
          await page.reload({ waitUntil: "domcontentloaded" });
          if (visual) await installVisualOperator(page, operatorOptions);
        } else if (op === "move") {
          if (!visual) throw new Error("move requires a visual session");
          step.cursor = await moveVisualCursor(page, action.x, action.y, { ...operatorOptions, durationMs: action.durationMs });
        } else if (op === "annotate") {
          if (!visual) throw new Error("annotate requires a visual session");
          const locator = await resolveLocator(page, action.selector);
          await locator.first().waitFor({
            state: "visible",
            timeout: normalizedTimeout(
              action.timeoutMs,
              defaultActionTimeoutMs ?? CLICK_TIMEOUT_MS,
            ),
          });
          const point = await visualPointForLocator(locator.first());
          await moveVisualCursor(page, point.x, point.y, { ...operatorOptions, durationMs: action.durationMs });
          await highlightVisualTarget(page, point.rect, { ...operatorOptions, color: action.color, label: action.label || action.selector });
          step.selector = action.selector;
          step.cursor = { x: Math.round(point.x), y: Math.round(point.y) };
        } else if (op === "clearAnnotations") {
          if (!visual) throw new Error("clearAnnotations requires a visual session");
          await clearVisualAnnotations(page, { keepCursor: action.keepCursor !== false });
        } else if (op === "eval") {
          if (typeof action.js !== "string" || !action.js.trim()) {
            throw new Error("eval requires non-empty js");
          }
          step.result = await evaluateAction(
            page,
            action.js,
            normalizedTimeout(
              action.timeoutMs,
              defaultActionTimeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS,
            ),
          );
        } else throw new Error(`unknown action type: ${op}`);
        if (action.settleMs) await page.waitForTimeout(Number(action.settleMs));
        step.ok = true;
      } catch (error) {
        step.ok = false; step.error = error.message; trace.push(step); break;
      }
      trace.push(step);
    }
    const metadata = await safePageMetadata(page);
    return {
      sessionId,
      ...metadata,
      trace,
      failed: trace.some((step) => !step.ok),
    };
  }

  async act(sessionId, actions = [], options = {}) {
    return await this._enqueue(
      sessionId,
      () => this._act(sessionId, actions, options),
      { kind: "act", timeoutMs: options.operationTimeoutMs },
    );
  }

  async _screenshot(sessionId, options = {}) {
    const session = this.get(sessionId, { allowClosing: true });
    const playwrightHealth = session.captureHealth.playwright;
    const preferredStrategy = (!options.strategy || options.strategy === "auto")
      && playwrightHealth.status === "degraded"
      && playwrightHealth.cdpSuccessesSinceFailure < PLAYWRIGHT_REPROBE_AFTER_CDP_SUCCESSES
      ? "cdp"
      : undefined;
    try {
      const result = await captureScreenshot(session.page, {
        ...options,
        preferredStrategy,
        outputDir: this.outputDir,
        sessionId,
      });
      updateCaptureHealth(session, result);
      return result;
    } catch (error) {
      updateCaptureHealth(session, error);
      throw error;
    }
  }

  async screenshot(sessionId, options = {}) {
    return await this._enqueue(
      sessionId,
      () => this._screenshot(sessionId, options),
      { kind: "screenshot", timeoutMs: options.operationTimeoutMs },
    );
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

  async _close(sessionId, session) {
    const id = String(sessionId || "");
    this.sessions.delete(id);
    const warnings = [];
    let video = null;
    if (session.mode === "cdp") {
      await settleWithin(() => session.page.close(), this.closeTimeoutMs, "page close", warnings);
    } else {
      await settleWithin(() => session.context.close(), this.closeTimeoutMs, "context close", warnings);
    }
    await settleWithin(() => session.browser.close(), this.closeTimeoutMs, "browser close", warnings);
    if (session.video) {
      video = await settleWithin(() => session.video.path(), this.closeTimeoutMs, "video path", warnings);
    }
    return { sessionId: id, closed: true, video, warnings };
  }

  async close(sessionId) {
    const id = String(sessionId || "");
    const session = this.sessions.get(id);
    if (!session) return { sessionId: id, closed: false };
    if (session.closePromise) return await session.closePromise;
    if (!session.captureHealth) session.captureHealth = createCaptureHealth();
    session.closing = true;
    this.sessions.delete(id);
    const closing = this._close(id, session);
    session.closePromise = closing;
    return await closing;
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}

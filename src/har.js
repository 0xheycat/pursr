// pursor — HAR (HTTP Archive) capture.
//
// Hooks page.on("request") / page.on("response") / page.on("requestfailed")
// on an active page and produces a HAR 1.2 spec blob:
//   { log: { version: "1.2", creator: {...}, browser: {...}, pages: [...], entries: [...] } }
//
// Use in code:
//   const { startHarCapture, stopHarCapture } = await import("pursor/har");
//   const har = await startHarCapture(page);
//   await page.goto(url);
//   await stopHarCapture(page);  // returns the HAR object
//
// Or via CLI/sweep:
//   pursor shoot <url> --har ./out/req.har.json
//
// HAR is useful for:
//   - killing flakiness from analytics/ads/CDN by mocking responses later
//   - inspecting what the page actually fetched during a capture
//   - regression diffing along with visual diffs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nowIso } from "./util.js";

const SYM = Symbol.for("pursor.har.capture");

function makeEntry(req, resp, startTs, endTs) {
  const url = req.url();
  const u = new URL(url);
  const headersList = (obj) => {
    if (!obj) return [];
    try {
      const out = [];
      for (const [name, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
          for (const v of value) out.push({ name, value: String(v) });
        } else {
          out.push({ name, value: String(value) });
        }
      }
      return out;
    } catch { return []; }
  };
  const queryString = u.search ? u.search.slice(1).split("&").filter(Boolean).map(kv => {
    const [k, v = ""] = kv.split("=");
    return { name: decodeURIComponent(k), value: decodeURIComponent(v) };
  }) : [];
  const postData = req.postData() ? { mimeType: req.postData() || "application/octet-stream", text: req.postData() } : undefined;
  const entry = {
    pageref: req.frame()?.url?.() || "_top",
    startedDateTime: new Date(startTs).toISOString(),
    time: Math.max(0, endTs - startTs),
    request: {
      method: req.method(),
      url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersList(req.headers()),
      queryString,
      headersSize: -1,
      bodySize: postData?.text?.length || 0,
      postData,
    },
    response: resp ? {
      status: resp.status(),
      statusText: resp.statusText() || "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersList(resp.headers()),
      content: { size: -1, mimeType: resp.headers()?.["content-type"] || "" },
      redirectURL: resp.headers()?.location || "",
      headersSize: -1,
      bodySize: -1,
    } : { status: 0, statusText: "Failed", httpVersion: "HTTP/1.1", cookies: [], headers: [], content: { size: 0, mimeType: "" }, redirectURL: "", headersSize: -1, bodySize: -1 },
    cache: {},
    timings: { send: 0, wait: Math.max(0, endTs - startTs), receive: 0 },
    serverIPAddress: "",
    connection: "",
  };
  return entry;
}

export async function startHarCapture(page, opts = {}) {
  if (!page) throw new Error("startHarCapture: page required");
  if (page[SYM]) return page[SYM]; // idempotent
  const started = Date.now();
  const entries = [];
  const pending = new Map(); // req -> startTs
  const state = {
    started,
    creator: { name: "pursor", version: opts.version || "0.3.0" },
    browser: { name: "chromium", version: "playwright-core" },
    pages: [],
    entries,
    pending,
  };
  const onReq = (req) => {
    pending.set(req, Date.now());
  };
  const onResp = async (resp) => {
    try {
      const req = resp.request();
      const startTs = pending.get(req) || Date.now();
      pending.delete(req);
      const endTs = Date.now();
      entries.push(makeEntry(req, resp, startTs, endTs));
    } catch {}
  };
  const onFailed = (req) => {
    try {
      const startTs = pending.get(req) || Date.now();
      pending.delete(req);
      entries.push(makeEntry(req, null, startTs, Date.now()));
    } catch {}
  };
  page.on("request", onReq);
  page.on("response", onResp);
  page.on("requestfailed", onFailed);
  state._teardown = () => {
    try { page.off("request", onReq); } catch {}
    try { page.off("response", onResp); } catch {}
    try { page.off("requestfailed", onFailed); } catch {}
  };
  page[SYM] = state;
  return state;
}

export function stopHarCapture(page) {
  if (!page || !page[SYM]) return null;
  const state = page[SYM];
  try { state._teardown?.(); } catch {}
  delete page[SYM];
  return finalizeHar(state);
}

export function finalizeHar(state) {
  if (!state) return null;
  return {
    log: {
      version: "1.2",
      creator: state.creator,
      browser: state.browser,
      pages: state.pages,
      entries: state.entries,
    },
    _meta: {
      started: state.started,
      finished: Date.now(),
      entryCount: state.entries.length,
    },
  };
}

export async function writeHar(har, file) {
  if (!har || !file) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(har, null, 2), "utf8");
  return file;
}

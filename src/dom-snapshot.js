//  pursr — DOM Snapshot + CSSOM + Selector Map.
//
// Every capture can optionally produce a .dom.json sidecar containing:
//   pursr - serialized DOM (document.documentElement.outerHTML)
//   pursr - computed styles for every visible element
//   pursr - selector map (id → role → accessible name → xpath → css selector)
//   pursr - viewport-relative bounding rects
//
// Useful for visual regression debugging without a browser —
// compare DOM structure directly.

import { launch, newPage } from "./runway.js";
import { resolveViewport } from "./viewport.js";
import { gotoOrThrow, settle } from "./overlays.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { nowIso, requireArg } from "./util.js";

// ─── Injected page script ──────────────────────────────────────────────
// Runs inside the browser to collect all DOM + CSSOM data in one pass.

const SNAPSHOT_PAGE_SCRIPT = `(() => {
  const results = {
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    dom: null,          // outerHTML
    selectorMap: [],    // element entries
    styles: {},         // cssText keyed by selector
  };

  // --- build xpath for an element ---
  function getXPath(el) {
    if (el === document.body) return '/html/body';
    if (el === document.documentElement) return '/html';
    let path = '';
    let current = el;
    while (current && current !== document.documentElement) {
      let idx = 1;
      let sib = current;
      while ((sib = sib.previousElementSibling) !== null) {
        if (sib.tagName === current.tagName) idx++;
      }
      path = '/' + current.tagName.toLowerCase() + '[' + idx + ']' + path;
      current = current.parentElement;
    }
    return '/html' + path;
  }

  // --- CSS selector for an element ---
  function getCSSSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    let path = [];
    let c = el;
    while (c && c !== document.documentElement) {
      let sel = c.tagName.toLowerCase();
      if (c.id) { path.unshift('#' + CSS.escape(c.id)); break; }
      if (c.className && typeof c.className === 'string') {
        const cls = c.className.trim().split(/\\s+/).filter(Boolean).map(cl => '.' + CSS.escape(cl)).join('');
        if (cls) sel += cls;
      }
      // add nth-child if needed
      const parent = c.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(ch => ch.tagName === c.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(c) + 1;
          sel += ':nth-of-type(' + idx + ')';
        }
      }
      path.unshift(sel);
      c = c.parentElement;
    }
    return path.join(' > ');
  }

  // --- collect element data ---
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    // skip non-visible / empty elements (but keep <canvas>, <img>, <video>, <svg>, input, textarea)
    const keep = ['canvas','img','video','svg','input','textarea','select','button','a','p','h1','h2','h3','h4','h5','h6','li','td','th','blockquote','code','pre','figure','figcaption'];
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
    if (!visible && !keep.includes(tag)) continue;
    if (['script','style','link','meta','head'].includes(tag)) continue;

    const id = el.id || null;
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    const text = ((el.textContent || '').trim().slice(0, 200)) || null;
    const placeholder = el.getAttribute('placeholder');
    const alt = el.getAttribute('alt');
    const href = el.getAttribute('href');
    const src = el.getAttribute('src');

    const entry = {
      tag,
      id,
      css: getCSSSelector(el),
      xpath: getXPath(el),
      role: role || null,
      ariaLabel: ariaLabel || null,
      text,
      placeholder: placeholder || null,
      alt: alt || null,
      href: href || null,
      src: src || null,
      rect: visible ? { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) } : null,
      visible,
    };

    // get computed role from accessibility tree
    try { entry.ariaRole = el.computedRole || el.getAttribute('role') || null; } catch {}

    results.selectorMap.push(entry);
  }

  function round(n) { return Math.round(n * 10) / 10; }

  // --- get all computed stylesheets ---
  for (let i = 0; i < document.styleSheets.length; i++) {
    try {
      const ss = document.styleSheets[i];
      const rules = ss.cssRules || ss.rules;
      if (!rules) continue;
      for (let j = 0; j < rules.length; j++) {
        const r = rules[j];
        if (r && r.cssText && r.selectorText) {
          if (!results.styles[r.selectorText]) results.styles[r.selectorText] = [];
          if (results.styles[r.selectorText].length < 5) {  // cap per selector
            results.styles[r.selectorText].push(r.cssText);
          }
        }
      }
    } catch {}
  }

  // --- serialize DOM ---
  results.dom = document.documentElement.outerHTML;

  return results;
})()`;

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Capture full DOM snapshot of a URL.
 * Returns the snapshot data AND writes it to out path.
 */
export async function captureDomSnapshot({ url, out, flags = {} }) {
  requireArg("url", url, "string");
  const viewport = resolveViewport(flags);
  const browser = await launch();
  try {
    const page = await newPage(browser, viewport);
    const r = await gotoOrThrow(page, url);
    await settle(page);
    // Give dynamic content a moment
    await page.waitForTimeout(500);
    const snapshot = await page.evaluate(SNAPSHOT_PAGE_SCRIPT);
    snapshot.navStatus = r.status;
    snapshot.navTitle = r.title;

    // Write output
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(snapshot, null, 2));
    }

    return snapshot;
  } finally {
    try { await browser.close(); } catch {}
  }
}

/**
 * Attach DOM snapshot as sidecar to an existing shoot result.
 * Call after runShoot — reuses the active page.
 */
export async function captureDomSnapshotSidecar(page, out) {
  if (!page || !out) return null;
  try {
    const snapshot = await page.evaluate(SNAPSHOT_PAGE_SCRIPT);
    const domPath = out.replace(/\.png$/i, ".dom.json");
    writeFileSync(domPath, JSON.stringify(snapshot, null, 2));
    return domPath;
  } catch {
    return null;
  }
}

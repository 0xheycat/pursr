// pursor — Auto-heal Selector Chain.
//
// In sweep plans, a selector can be an array of fallback strategies:
//   "click": { "selector": ["text=Login", "button[type=submit]", "#login-btn"] }
//
// resolveHealedSelector tries each one in order, returns the first match.
// Also supports named matchers (text=, role=, aria=, placeholder=, css=)
// and plain CSS selectors.

import { resolveLocator } from "./selector.js";
import { CLICK_TIMEOUT_MS } from "./overlays.js";

/**
 * Resolve a selector that may be a chain of fallbacks.
 *
 * @param {import("playwright-core").Page} page
 * @param {string|string[]} selector - Single selector or array of fallbacks
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Per-selector timeout
 * @param {boolean} [opts.returnAll] - Return ALL matching locators (first found, rest as fallbacks)
 * @returns {Promise<{ locator: import("playwright-core").Locator, selector: string, index: number }|null>}
 *
 * Example:
 *   const result = await resolveHealedSelector(page, ["text=Login", "button[type=submit]", "#login-btn"]);
 *   if (result) await result.locator.first().click();
 */
export async function resolveHealedSelector(page, selector, opts = {}) {
  if (!selector) throw new Error("empty selector");
  if (!page) throw new Error("page required");

  const chains = Array.isArray(selector) ? selector : [selector];
  const timeout = opts.timeout || CLICK_TIMEOUT_MS;
  let lastError = null;

  for (let i = 0; i < chains.length; i++) {
    const sel = String(chains[i]).trim();
    if (!sel) continue;

    try {
      // Use existing resolveLocator for text=/role=/aria=/placeholder= prefixes
      const locator = await resolveLocator(page, sel);
      const count = await locator.count();
      if (count > 0) {
        // Quick visibility check without awaiting each element individually
        const visible = await locator.first().isVisible().catch(() => false);
        if (visible) {
          return { locator, selector: sel, index: i, count };
        }
        // Found but not visible — try next if available
        lastError = new Error(`Found "${sel}" (x${count}) but not visible`);
        continue;
      }
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  // If nothing matched, throw with helpful message about what was tried
  if (lastError) throw new Error(`Selector chain exhausted: tried [${chains.join(", ")}]. Last error: ${lastError.message}`);
  throw new Error(`Selector chain exhausted: tried [${chains.join(", ")}]. No match found.`);
}

/**
 * Simplify: extract a single selector string for logging / display
 * from a selector chain.
 */
export function displaySelector(selector) {
  return Array.isArray(selector) ? selector[0] : selector;
}

/**
 * Wrap a step's click/hover/type/wait selector calls with auto-heal support.
 * Mutates the step action object in-place: resolves string → {selector, ...} to
 * the first matching selector.
 */
export async function healStepAction(page, action) {
  if (!action || !action.selector) return action;
  const result = await resolveHealedSelector(page, action.selector);
  // Replace chain with the single resolved selector for logging
  action._resolvedSelector = result.selector;
  action._healAttempts = Array.isArray(action.selector) ? action.selector.length : 1;
  action.selector = result.selector;
  return action;
}

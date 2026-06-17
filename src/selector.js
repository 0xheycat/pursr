// Selector parsing + resolution. Reused by click/type/wait/hover/seq.

export function parseTextSelector(rest) {
  const m = rest.match(/^(text=)(={1,2}|~)?(.*?)(\[\d+\])?$/);
  if (!m) return null;
  const exact = m[2] === "==";
  const regex = m[2] === "~";
  const nth = m[4] ? Number(m[4].slice(1, -1)) : undefined;
  const text = regex ? new RegExp(m[3], "i") : m[3];
  return { text, exact, regex, nth };
}

export async function resolveLocator(page, selector) {
  if (!selector) throw new Error("empty selector");
  if (selector.startsWith("text=")) {
    const p = parseTextSelector(selector);
    if (!p) throw new Error(`bad text= selector: ${selector}`);
    let loc = p.exact ? page.getByText(p.text, { exact: true })
      : p.regex ? page.getByText(p.text)
      : page.getByText(p.text);
    if (p.nth) loc = loc.nth(p.nth - 1);
    return loc;
  }
  if (selector.startsWith("role=")) {
    const [role, name] = selector.slice(5).split("|", 2);
    return page.getByRole(role.trim(), name ? { name: name.trim() } : undefined);
  }
  if (selector.startsWith("aria=")) return page.getByLabel(selector.slice(5));
  if (selector.startsWith("placeholder=")) return page.getByPlaceholder(selector.slice("placeholder=".length));
  return page.locator(selector);
}
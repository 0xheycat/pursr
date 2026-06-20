// Selector parsing + resolution. Reused by click/type/wait/hover/seq.

export function parseTextSelector(rest) {
  // text==Exact[0]  → exact match, nth 0
  // text~regex      → regex match
  // text=Hello      → substring match
  let m = rest.match(/^text~\/?(.+?)\/?(\[(\d+)\])?$/);
  if (m) {
    const source = m[1].replace(/\\\//g, "/");
    try {
      return { text: new RegExp(source, "i"), exact: false, regex: true, nth: m[3] !== undefined ? Number(m[3]) : undefined };
    } catch { return null; }
  }
  m = rest.match(/^text(={1,2})(.*?)(\[(\d+)\])?$/);
  if (!m) return null;
  const exact = m[1] === "==";
  const nth = m[3] !== undefined ? Number(m[4]) : undefined;
  return { text: m[2], exact, regex: false, nth };
}

export async function resolveLocator(page, selector) {
  if (!selector) throw new Error("empty selector");
  if (selector.startsWith("text=")) {
    const p = parseTextSelector(selector);
    if (!p) throw new Error(`bad text= selector: ${selector}`);
    let loc = p.exact ? page.getByText(p.text, { exact: true })
      : p.regex ? page.getByText(p.text)
      : page.getByText(p.text);
    if (p.nth !== undefined) loc = loc.nth(p.nth - 1);
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
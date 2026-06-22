// Visible cursor and interaction feedback for agent-driven browser sessions.

const DEFAULT_COLOR = "#ff2ea6";

function safeColor(value) {
  const color = String(value || DEFAULT_COLOR).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(color)) return color;
  if (/^[a-z]{1,24}$/i.test(color)) return color;
  return DEFAULT_COLOR;
}

export async function installVisualOperator(page, options = {}) {
  const color = safeColor(options.color);
  await page.evaluate(({ color }) => {
    if (document.getElementById("__pursr_operator_style__")) return;
    const style = document.createElement("style");
    style.id = "__pursr_operator_style__";
    style.textContent = `
      #__pursr_cursor__ { position: fixed; left: 0; top: 0; width: 28px; height: 34px;
        pointer-events: none; z-index: 2147483647; transform: translate(24px, 24px);
        filter: drop-shadow(0 2px 2px rgba(0,0,0,.55)); transition: none; }
      #__pursr_cursor__ svg { display: block; width: 100%; height: 100%; }
      .__pursr_target__ { position: fixed; pointer-events: none; z-index: 2147483645;
        border: 3px solid var(--pursr-color); border-radius: 7px;
        box-shadow: 0 0 0 2px rgba(255,255,255,.92), 0 0 18px var(--pursr-color); }
      .__pursr_label__ { position: absolute; left: -3px; bottom: calc(100% + 7px);
        padding: 3px 7px; border-radius: 4px; background: var(--pursr-color); color: white;
        font: 700 12px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
        white-space: nowrap; text-shadow: 0 1px 1px rgba(0,0,0,.35); }
      .__pursr_click__ { position: fixed; width: 28px; height: 28px; margin: -14px 0 0 -14px;
        pointer-events: none; z-index: 2147483646; border: 4px solid var(--pursr-color);
        border-radius: 50%; box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 20px var(--pursr-color); }
    `;
    document.documentElement.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "__pursr_cursor__";
    cursor.dataset.x = "24";
    cursor.dataset.y = "24";
    cursor.style.setProperty("--pursr-color", color);
    cursor.innerHTML = `<svg viewBox="0 0 28 34" aria-hidden="true"><path d="M3 2.5V27l6.8-6.2 4.7 10.2 5.2-2.5-4.7-9.8 9.4-.2z" fill="${color}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M3 2.5V27l6.8-6.2 4.7 10.2 5.2-2.5-4.7-9.8 9.4-.2z" fill="none" stroke="#16131a" stroke-width="1" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(cursor);
  }, { color });
}

export async function moveVisualCursor(page, x, y, options = {}) {
  await installVisualOperator(page, options);
  const durationMs = Math.max(0, Math.min(3000, Number(options.durationMs) || 220));
  const point = { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) };
  await page.evaluate(async ({ point, durationMs }) => {
    const cursor = document.getElementById("__pursr_cursor__");
    if (!cursor) return;
    const startX = Number(cursor.dataset.x) || 0;
    const startY = Number(cursor.dataset.y) || 0;
    const started = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const progress = durationMs ? Math.min(1, (now - started) / durationMs) : 1;
        const eased = 1 - Math.pow(1 - progress, 3);
        const nextX = startX + (point.x - startX) * eased;
        const nextY = startY + (point.y - startY) * eased;
        cursor.style.transform = `translate(${nextX}px, ${nextY}px)`;
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    cursor.dataset.x = String(point.x);
    cursor.dataset.y = String(point.y);
  }, { point, durationMs });
  await page.mouse.move(point.x, point.y, { steps: Math.max(1, Math.min(20, Math.ceil(durationMs / 20))) });
  return point;
}

export async function highlightVisualTarget(page, rect, options = {}) {
  await installVisualOperator(page, options);
  const color = safeColor(options.color);
  const label = String(options.label || "target").slice(0, 80);
  await page.evaluate(({ rect, color, label }) => {
    document.querySelectorAll(".__pursr_target__").forEach((node) => node.remove());
    const target = document.createElement("div");
    target.className = "__pursr_target__";
    target.style.setProperty("--pursr-color", color);
    target.style.left = `${Math.round(rect.x)}px`;
    target.style.top = `${Math.round(rect.y)}px`;
    target.style.width = `${Math.max(0, Math.round(rect.width))}px`;
    target.style.height = `${Math.max(0, Math.round(rect.height))}px`;
    const tag = document.createElement("span");
    tag.className = "__pursr_label__";
    tag.textContent = label;
    target.appendChild(tag);
    document.documentElement.appendChild(target);
  }, { rect, color, label });
}

export async function markVisualClick(page, x, y, options = {}) {
  await installVisualOperator(page, options);
  const color = safeColor(options.color);
  await page.evaluate(({ x, y, color }) => {
    document.querySelectorAll(".__pursr_click__").forEach((node) => node.remove());
    const marker = document.createElement("div");
    marker.className = "__pursr_click__";
    marker.style.setProperty("--pursr-color", color);
    marker.style.left = `${Math.round(x)}px`;
    marker.style.top = `${Math.round(y)}px`;
    document.documentElement.appendChild(marker);
  }, { x, y, color });
}

export async function clearVisualAnnotations(page, { keepCursor = true } = {}) {
  await page.evaluate(({ keepCursor }) => {
    document.querySelectorAll(".__pursr_target__, .__pursr_click__").forEach((node) => node.remove());
    if (!keepCursor) {
      document.getElementById("__pursr_cursor__")?.remove();
      document.getElementById("__pursr_operator_style__")?.remove();
    }
  }, { keepCursor });
}

export async function visualPointForLocator(locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("target has no visible bounding box");
  return { rect, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

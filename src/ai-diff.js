// pursor - AI diff summary.
//
// Sends two images (reference + current) to a vision-capable LLM and asks
// it to describe the visual differences in plain language. This gives you
// a human-readable summary alongside the pixel-diff percentage.
//
// Supports any OpenAI-compatible chat completions endpoint that accepts
// image_url content parts (OpenAI, Anthropic via proxy, local llama.cpp,
// Codex tokenrouter, etc).
//
// CLI:
//   pursr diff <url> <ref.png> <out.png> --ai
//   pursr diff <url> <ref.png> <out.png> --ai-model gh/gpt-5.4
//
// Library:
//   import { aiDiffSummary } from "pursr/ai-diff";
//   const summary = await aiDiffSummary({ refPath, curPath, url, model });

import { readFileSync, existsSync } from "node:fs";

// Read env at call time so tests can mutate process.env between calls.
function _defaultBase() { return process.env.PURSOR_AI_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.openai.com/v1"; }
function _defaultKey()  { return process.env.PURSOR_AI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.OPENAI_API_KEY; }
function _defaultModel(){ return process.env.PURSOR_AI_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "gpt-4o"; }

const SYSTEM_PROMPT = `You are a visual regression analyst. Given two screenshots of the same web page (reference vs current), produce a concise, structured report of the visual differences.

Output format (markdown, keep under 250 words):

**Overall:** one sentence verdict (looks identical / minor changes / major regression).
**Layout shifts:** list any element that moved, resized, or appeared/disappeared.
**Color / style:** any color, font, or spacing changes.
**Content:** new, removed, or changed text/imagery.
**Likely cause:** best guess at what code or content change caused this.

Be specific (mention element labels, regions). Be honest about uncertainty.`;

/**
 * Send reference + current PNGs to a vision model and return a textual diff summary.
 *
 * @param {object} opts
 * @param {string} opts.refPath   - Path to reference PNG
 * @param {string} opts.curPath   - Path to current PNG
 * @param {string} [opts.url]     - URL that was captured (for context)
 * @param {string} [opts.model]   - Model id (default: gpt-4o)
 * @param {string} [opts.baseUrl] - OpenAI-compatible base URL
 * @param {string} [opts.apiKey]  - API key
 * @param {number} [opts.maxTokens=600]
 * @returns {Promise<{ summary: string, model: string, elapsedMs: number, usage?: object }>}
 */
export async function aiDiffSummary(opts) {
  if (!opts.refPath || !opts.curPath) throw new Error("aiDiffSummary: refPath and curPath required");
  if (!existsSync(opts.refPath)) throw new Error(`aiDiffSummary: ref not found: ${opts.refPath}`);
  if (!existsSync(opts.curPath)) throw new Error(`aiDiffSummary: cur not found: ${opts.curPath}`);

  const baseUrl = (opts.baseUrl || _defaultBase()).replace(/\/+$/, "");
  const apiKey = opts.apiKey || _defaultKey();
  const model = opts.model || _defaultModel();
  if (!apiKey) {
    throw new Error("aiDiffSummary: no API key. Set PURSOR_AI_API_KEY, ANTHROPIC_AUTH_TOKEN, or OPENAI_API_KEY.");
  }

  const refB64 = readFileSync(opts.refPath).toString("base64");
  const curB64 = readFileSync(opts.curPath).toString("base64");
  const userText = opts.url
    ? `URL: ${opts.url}\n\nCompare these two screenshots of the same page (reference first, current second). Describe the visual differences.`
    : `Compare these two screenshots (reference first, current second). Describe the visual differences.`;

  const body = {
    model,
    max_tokens: opts.maxTokens || 600,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "REFERENCE:" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${refB64}` } },
          { type: "text", text: "CURRENT:" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${curB64}` } },
          { type: "text", text: userText },
        ],
      },
    ],
  };

  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`aiDiffSummary: ${res.status} ${res.statusText} - ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const summary = data.choices?.[0]?.message?.content?.trim() || "(empty response)";
  return {
    summary,
    model,
    elapsedMs: Date.now() - t0,
    usage: data.usage,
  };
}

/**
 * Compare two PNGs and return a JSON-friendly object suitable for embedding
 * in a sweep step's meta sidecar.
 */
export async function aiDiffSidecar(opts) {
  const r = await aiDiffSummary(opts);
  return {
    aiSummary: r.summary,
    aiModel: r.model,
    aiElapsedMs: r.elapsedMs,
    aiAt: new Date().toISOString(),
  };
}

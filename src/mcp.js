// pursor — MCP stdio server (Model Context Protocol).
//
// Implements JSON-RPC 2.0 over stdio with Content-Length framing.
// Exposes every pursor capability as an MCP tool for use by
// Claude Code, Cursor, Continue, and any other MCP host.
//
// Config via PURSOR_MCP_CONFIG env or ~/.pursor/mcp-config.json:
//   { "plugins": ["./my-plugin.js"], "defaultOutDir": "./mcp-output" }

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { runProbe } from "./probe.js";
import { runShoot } from "./shoot.js";
import { runDiff } from "./diff.js";
import { runSweep } from "./sweep.js";
import { runFrames } from "./frames.js";
import { runShootWithSidecar } from "./shoot.js";
import { captureDomSnapshot } from "./dom-snapshot.js";
import { runAudit } from "./plugin-audit.js";
import { loadPlugins, listPlugins } from "./plugin.js";
import { makeOut, nowIso } from "./util.js";
import { createRequire } from "node:module";

const __require = createRequire(import.meta.url);
let _pkg = { version: "0.1.0" };
try { _pkg = __require("../package.json"); } catch {}

const MCP_VERSION = "0.1.0";

// ─── Config ──────────────────────────────────────────────────────────────

function loadConfig() {
  const envRaw = process.env.PURSOR_MCP_CONFIG;
  if (envRaw) {
    try { return JSON.parse(envRaw); } catch { /* not JSON, treat as path */ }
    try { return JSON.parse(readFileSync(envRaw, "utf8")); } catch {}
  }
  const configDir = join(homedir(), ".pursor");
  const configPath = join(configDir, "mcp-config.json");
  if (existsSync(configPath)) {
    try { return JSON.parse(readFileSync(configPath, "utf8")); } catch {}
  }
  return {};
}

// ─── MCP Error ───────────────────────────────────────────────────────────

class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "McpError";
  }
}

// ─── Server ──────────────────────────────────────────────────────────────

class PursorMCPServer {
  constructor(config = {}) {
    this.config = config;
    this._buffer = Buffer.alloc(0);
    this._contentLength = -1;
    this._initialized = false;
    this._verbose = !!config.verbose;
  }

  log(...args) {
    if (this._verbose) console.error("[pursor-mcp]", ...args);
  }

  async start() {
    if (this.config.plugins?.length) {
      await loadPlugins(this.config.plugins);
    }
    this.log("server started, plugins:", listPlugins());

    process.stdin.on("data", (chunk) => {
      this._buffer = Buffer.concat([this._buffer, chunk]);
      this._processBuffer();
    });
    process.stdin.on("end", () => {
      this.log("stdin closed");
    });

    process.on("uncaughtException", (err) => {
      console.error("[pursor-mcp] uncaught:", err.message);
    });
  }

  // ── Buffer framing ──────────────────────────────────────────────────

  _processBuffer() {
    while (true) {
      if (this._contentLength < 0) {
        const idx = this._buffer.indexOf(Buffer.from("\r\n\r\n"));
        if (idx === -1) break;
        const header = this._buffer.slice(0, idx).toString("utf8");
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (m) this._contentLength = parseInt(m[1], 10);
        this._buffer = this._buffer.slice(idx + 4);
      }
      if (this._contentLength > 0 && this._buffer.length >= this._contentLength) {
        const raw = this._buffer.slice(0, this._contentLength).toString("utf8");
        this._buffer = this._buffer.slice(this._contentLength);
        this._contentLength = -1;
        try {
          const msg = JSON.parse(raw);
          this._handleMessage(msg);
        } catch (e) {
          console.error("[pursor-mcp] invalid JSON:", e.message);
        }
      } else break;
    }
  }

  _send(msg) {
    const json = JSON.stringify(msg);
    const bytes = Buffer.from(json, "utf8");
    const header = `Content-Length: ${bytes.length}\r\n\r\n`;
    process.stdout.write(header);
    process.stdout.write(bytes);
  }

  // ── JSON-RPC dispatcher ─────────────────────────────────────────────

  async _handleMessage(msg) {
    if (!msg || msg.jsonrpc !== "2.0" || !msg.method) {
      console.error("[pursor-mcp] skipping non-JSON-RPC message");
      return;
    }
    const { method, id } = msg;

    // Notifications — no id → no response
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      if (method === "notifications/initialized") this._initialized = true;
      return;
    }
    if (id === undefined || id === null) return; // unnamed notification

    try {
      switch (method) {
        case "initialize":
          this._initialized = true;
          this._send({
            jsonrpc: "2.0", id,
            result: {
              protocolVersion: msg.params?.protocolVersion || "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "pursor", version: MCP_VERSION },
            },
          });
          break;

        case "tools/list":
          this._send({ jsonrpc: "2.0", id, result: { tools: this._toolDefs() } });
          break;

        case "tools/call":
          if (!msg.params?.name) throw new McpError(-32602, "Missing tool name");
          const result = await this._callTool(msg.params.name, msg.params.arguments || {});
          this._send({ jsonrpc: "2.0", id, result: { content: result } });
          break;

        default:
          this._send({
            jsonrpc: "2.0", id,
            error: { code: -32601, message: `Unknown method: ${method}` },
          });
      }
    } catch (e) {
      if (e instanceof McpError) {
        this._send({ jsonrpc: "2.0", id, error: { code: e.code, message: e.message } });
      } else {
        console.error("[pursor-mcp] handler error:", e.stack || e.message);
        this._send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
      }
    }
  }

  // ── Tool definitions ────────────────────────────────────────────────

  _toolDefs() {
    return [
      {
        name: "pursor_shoot",
        description: "Capture a screenshot of a URL with full feature control (viewport, grid, layer, cursor, camera, animation freeze). Returns PNG path and sidecar metadata.",
        inputSchema: {
          type: "object",
          properties: {
            url:              { type: "string", description: "Target URL" },
            out:              { type: "string", description: "Output PNG path (auto-gen if omitted)" },
            preset:           { type: "string", description: "Viewport preset: desktop-1280, desktop-1440, desktop-1920, mobile-375, etc." },
            width:            { type: "number", description: "Viewport width (custom)" },
            height:           { type: "number", description: "Viewport height (custom)" },
            dpr:              { type: "number", description: "Device pixel ratio" },
            full:             { type: "boolean", description: "Full-page screenshot" },
            cursor:           { type: "string", description: "Cursor: default|pointer|grab|grabbing|crosshair|none" },
            grid:             { type: "boolean", description: "Overlay grid" },
            "grid-tile":     { type: "number", description: "Grid tile size (px)" },
            "grid-color":    { type: "string", description: "Grid line color" },
            layer:            { type: "string", description: "Layer isolation: all|entity|terrain|hud|ui" },
            zoom:             { type: "number", description: "Camera zoom factor" },
            panX:             { type: "number", description: "Camera pan X (px)" },
            panY:             { type: "number", description: "Camera pan Y (px)" },
            "no-animation":  { type: "boolean", description: "Freeze CSS animations" },
            "wait-frame":    { type: "number", description: "Wait for stable canvas frame (ms)" },
            "no-hud":        { type: "boolean", description: "Hide header/footer/nav elements" },
          },
          required: ["url"],
        },
      },
      {
        name: "pursor_diff",
        description: "Pixel-diff a URL against a reference PNG. Returns diff stats and writes diff overlay image.",
        inputSchema: {
          type: "object",
          properties: {
            url:       { type: "string", description: "URL to capture" },
            ref:       { type: "string", description: "Reference PNG path" },
            out:       { type: "string", description: "Diff output PNG (auto-gen if omitted)" },
            threshold: { type: "number", description: "Pixelmatch threshold 0-1 (default 0.1)" },
          },
          required: ["url", "ref"],
        },
      },
      {
        name: "pursor_sweep",
        description: "Execute a batch sweep plan (JSON file). Runs multiple capture steps sequentially, returns summary + HTML report.",
        inputSchema: {
          type: "object",
          properties: {
            plan:   { type: "string", description: "Path to sweep plan JSON" },
            outDir: { type: "string", description: "Output directory (default from plan)" },
          },
          required: ["plan"],
        },
      },
      {
        name: "pursor_frames",
        description: "Capture an animation frame timeline — N screenshots at a given interval.",
        inputSchema: {
          type: "object",
          properties: {
            url:         { type: "string", description: "Target URL" },
            count:       { type: "number", description: "Number of frames 1-120 (default 8)" },
            intervalMs:  { type: "number", description: "Interval between frames in ms (default 250)" },
            outDir:      { type: "string", description: "Output directory (auto-gen if omitted)" },
          },
          required: ["url"],
        },
      },
      {
        name: "pursor_probe",
        description: "Health-check a URL: returns HTTP status, page title, nav errors. No screenshot.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to probe" },
          },
          required: ["url"],
        },
      },
      {
        name: "pursor_audit",
        description: "Run axe-core WCAG accessibility audit on a URL. Returns violation summary, saves full report + highlighted screenshot.",
        inputSchema: {
          type: "object",
          properties: {
            url:        { type: "string", description: "Target URL" },
            tags:       { type: "string", description: "Comma-separated WCAG tags: wcag2a,wcag2aa,wcag21a,wcag21aa" },
            outDir:     { type: "string", description: "Output directory (auto-gen if omitted)" },
            screenshot: { type: "boolean", description: "Capture highlighted screenshot (default true)" },
          },
          required: ["url"],
        },
      },
      {
        name: "pursor_dom_snapshot",
        description: "Full DOM snapshot: serialized HTML, computed styles per visible element, selector map (id/role/text/xpath), bounding rects. Stored as .dom.json sidecar.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Target URL" },
            out: { type: "string", description: "Output .dom.json path (auto-gen if omitted)" },
          },
          required: ["url"],
        },
      },
    ];
  }

  // ── Tool dispatcher ─────────────────────────────────────────────────

  async _callTool(name, args) {
    switch (name) {
      case "pursor_shoot":        return await this._shoot(args);
      case "pursor_diff":         return await this._diff(args);
      case "pursor_sweep":        return await this._sweep(args);
      case "pursor_frames":       return await this._frames(args);
      case "pursor_probe":        return await this._probe(args);
      case "pursor_audit":        return await this._audit(args);
      case "pursor_dom_snapshot": return await this._domSnapshot(args);
      default: throw new McpError(-32602, `Unknown tool: ${name}`);
    }
  }

  // ── Tool implementations ────────────────────────────────────────────

  async _shoot(args) {
    const url = args.url;
    if (!url) throw new McpError(-32602, "Missing required: url");

    const defDir = this.config.defaultOutDir || process.cwd();
    const out = args.out || join(defDir, `mcp-shoot-${Date.now()}.png`);
    if (out) mkdirSync(dirname(out), { recursive: true });

    const flags = {};
    for (const [k, v] of Object.entries(args)) {
      if (k !== "url" && k !== "out") flags[k] = v;
    }

    const meta = await runShootWithSidecar({ url, out, flags });
    const sidecar = meta.out && existsSync(meta.out.replace(/\.png$/i, ".json"))
      ? JSON.parse(readFileSync(meta.out.replace(/\.png$/i, ".json"), "utf8"))
      : meta;

    return [{ type: "text", text: JSON.stringify({ out, meta: sidecar }, null, 2) }];
  }

  async _diff(args) {
    const { url, ref } = args;
    if (!url) throw new McpError(-32602, "Missing required: url");
    if (!ref) throw new McpError(-32602, "Missing required: ref");
    if (!existsSync(ref)) throw new McpError(-32602, `Reference file not found: ${ref}`);

    const out = args.out || ref.replace(/\.png$/i, "-diff.png");
    if (out) mkdirSync(dirname(out), { recursive: true });
    const threshold = args.threshold ?? 0.1;
    const result = await runDiff(url, ref, out, threshold);
    return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  }

  async _sweep(args) {
    if (!args.plan) throw new McpError(-32602, "Missing required: plan");
    if (!existsSync(args.plan)) throw new McpError(-32602, `Plan file not found: ${args.plan}`);
    const summary = await runSweep(args.plan, args.outDir);
    return [{ type: "text", text: JSON.stringify(summary, null, 2) }];
  }

  async _frames(args) {
    if (!args.url) throw new McpError(-32602, "Missing required: url");
    const defDir = this.config.defaultOutDir || process.cwd();
    const outDir = args.outDir || join(defDir, `mcp-frames-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    const result = await runFrames({
      url: args.url,
      count: args.count,
      intervalMs: args.intervalMs,
      outDir,
    });
    return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  }

  async _probe(args) {
    if (!args.url) throw new McpError(-32602, "Missing required: url");
    const result = await runProbe(args.url);
    return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  }

  async _audit(args) {
    if (!args.url) throw new McpError(-32602, "Missing required: url");
    const tags = args.tags ? args.tags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
    const defDir = this.config.defaultOutDir || process.cwd();
    const outDir = args.outDir || join(defDir, `mcp-audit-${Date.now()}`);
    const result = await runAudit({
      url: args.url,
      tags,
      outDir,
      screenshot: args.screenshot !== false,
    });
    return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  }

  async _domSnapshot(args) {
    if (!args.url) throw new McpError(-32602, "Missing required: url");
    const defDir = this.config.defaultOutDir || process.cwd();
    const out = args.out || join(defDir, `dom-snapshot-${Date.now()}.dom.json`);
    mkdirSync(dirname(out), { recursive: true });
    const result = await captureDomSnapshot({ url: args.url, out });
    return [{ type: "text", text: JSON.stringify({ out, ...result }, null, 2) }];
  }
}

export { PursorMCPServer, McpError, loadConfig, MCP_VERSION };

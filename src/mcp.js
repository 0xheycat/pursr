//  pursr — MCP stdio server (Model Context Protocol).
//
// Implements JSON-RPC 2.0 over stdio with Content-Length framing.
// Exposes every pursr capability as an MCP tool for use by
// Claude Code, Cursor, Continue, and any other MCP host.
//
// Config via PURSR_MCP_CONFIG env or ~/./mcp-config.json:
//   { "plugins": ["./my-plugin.js"], "defaultOutDir": "./mcp-output" }

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { __PURSR_GET } from "./util.js";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { runProbe } from "./probe.js";
import { runShoot } from "./shoot.js";
import { runDiff } from "./diff.js";
import { runCheck } from "./check.js";
import { runSweep } from "./sweep.js";
import { runFrames } from "./frames.js";
import { runShootWithSidecar } from "./shoot.js";
import { captureDomSnapshot } from "./dom-snapshot.js";
import { runAudit } from "./plugin-audit.js";
import { loadPlugins, listPlugins } from "./plugin.js";
import { makeOut, nowIso } from "./util.js";
import { listResources, readResource, recordResource } from "./mcp-resources.js";
import { createRequire } from "node:module";
import { BrowserSessionManager } from "./session.js";

const __require = createRequire(import.meta.url);
let _pkg = { version: "0.1.0" };
try { _pkg = __require("../package.json"); } catch {}

const MCP_VERSION = "0.1.0";

// ─── Config ──────────────────────────────────────────────────────────────

function loadConfig() {
  const envRaw = __PURSR_GET("PURSR_MCP_CONFIG");
  if (envRaw) {
    try { return JSON.parse(envRaw); } catch { /* not JSON, treat as path */ }
    try { return JSON.parse(readFileSync(envRaw, "utf8")); } catch {}
  }
  const configDir = join(homedir(), ".pursr");
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

class PursrMCPServer {
  constructor(config = {}) {
    this.config = config;
    this._buffer = Buffer.alloc(0);
    this._contentLength = -1;
    this._initialized = false;
    this._verbose = !!config.verbose;
    this.sessions = new BrowserSessionManager({ outputDir: config.defaultOutDir || process.cwd() });
  }

  log(...args) {
    if (this._verbose) console.error("[pursr-mcp]", ...args);
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
      this.sessions.closeAll().catch(() => {});
    });

    process.on("uncaughtException", (err) => {
      console.error("[pursr-mcp] uncaught:", err.message);
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
          console.error("[pursr-mcp] invalid JSON:", e.message);
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
      console.error("[pursr-mcp] skipping non-JSON-RPC message");
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
              serverInfo: { name: "pursr", version: MCP_VERSION },
            },
          });
          break;

        case "tools/list":
          this._send({ jsonrpc: "2.0", id, result: { tools: this._toolDefs() } });
          break;

        case "resources/list":
          this._send({ jsonrpc: "2.0", id, result: { resources: listResources().map(this._toMcpResource, this) } });
          break;

        case "resources/read":
          if (!msg.params?.uri) throw new McpError(-32602, "Missing uri");
          const data = readResource(msg.params.uri);
          if (!data) throw new McpError(-32602, "Resource not found: " + msg.params.uri);
          this._send({ jsonrpc: "2.0", id, result: { contents: [data] } });
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
        console.error("[pursr-mcp] handler error:", e.stack || e.message);
        this._send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
      }
    }
  }

  // ── Resource shape adapter ─────────────────────────────────────────

  _toMcpResource(r) {
    return {
      uri: r.uri,
      name: r.name,
      description: r.description || (r.kind + ": " + r.id),
      mimeType: r.mimeType || "application/octet-stream",
    };
  }

  // ── Tool definitions ────────────────────────────────────────────────

  _toolDefs() {
    return [
      {
        name: "pursr_session_open",
        description: "Open a persistent browser tab for iterative agent work. State, hover, scroll, dialogs, and navigation persist until closed.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Initial URL" },
            sessionId: { type: "string", description: "Stable session name; generated when omitted" },
            preset: { type: "string", description: "Viewport preset" },
            width: { type: "number" }, height: { type: "number" }, dpr: { type: "number" },
            storageState: { description: "Playwright storageState object or file path" },
          },
          required: ["url"],
        },
      },
      {
        name: "pursr_sessions",
        description: "List active persistent browser sessions.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pursr_snapshot",
        description: "Read the current rendered state from a persistent session as concise visible nodes, geometry, semantics, and computed visual styles.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" }, selector: { type: "string", description: "CSS root selector (default body)" },
            maxNodes: { type: "number", description: "Maximum returned nodes, 1-1000" },
            includeStyles: { type: "boolean", description: "Include compact computed styles (default true)" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "pursr_act",
        description: "Perform ordered actions in a persistent session. Supported types: click, hover, fill, type, check, select, press, scroll, wait, sleep, navigate, reload, eval.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            actions: { type: "array", minItems: 1, maxItems: 50, items: { type: "object" } },
          },
          required: ["sessionId", "actions"],
        },
      },
      {
        name: "pursr_screenshot",
        description: "Capture the current persistent session and return the PNG directly to the model as image content.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" }, out: { type: "string" }, full: { type: "boolean" },
            selector: { type: "string", description: "Capture only the first matching element" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "pursr_inspect",
        description: "Inspect one rendered element: HTML, exact geometry, computed style, and clipping/stacking ancestors.",
        inputSchema: {
          type: "object", properties: { sessionId: { type: "string" }, selector: { type: "string" } }, required: ["sessionId", "selector"],
        },
      },
      {
        name: "pursr_diagnostics",
        description: "Read console messages, page errors, failed requests, and HTTP 4xx/5xx responses accumulated during a persistent session.",
        inputSchema: {
          type: "object", properties: { sessionId: { type: "string" }, clear: { type: "boolean" } }, required: ["sessionId"],
        },
      },
      {
        name: "pursr_session_close",
        description: "Close a persistent browser session and release its browser process.",
        inputSchema: {
          type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"],
        },
      },
      {
        name: "pursr_shoot",
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
        name: "pursr_diff",
        description: "Pixel-diff a URL against a reference PNG. Honors the same viewport/camera/animation flags as pursr_shoot. Returns diff stats and writes diff overlay image.",
        inputSchema: {
          type: "object",
          properties: {
            url:           { type: "string", description: "URL to capture" },
            ref:           { type: "string", description: "Reference PNG path" },
            out:           { type: "string", description: "Diff output PNG (auto-gen if omitted)" },
            threshold:     { type: "number", description: "Pixelmatch threshold 0-1 (default 0.1)" },
            preset:        { type: "string", description: "Viewport preset" },
            width:         { type: "number", description: "Viewport width" },
            height:        { type: "number", description: "Viewport height" },
            dpr:           { type: "number", description: "Device pixel ratio" },
            full:          { type: "boolean", description: "Full-page screenshot" },
            cursor:        { type: "string", description: "Cursor: default|pointer|grab|grabbing|crosshair|none" },
            grid:          { type: "boolean", description: "Overlay grid" },
            zoom:          { type: "number", description: "Camera zoom" },
            panX:          { type: "number", description: "Camera pan X (px)" },
            panY:          { type: "number", description: "Camera pan Y (px)" },
            "no-animation":{ type: "boolean", description: "Freeze CSS animations for a stable diff" },
            "wait-frame": { type: "number", description: "Wait for stable canvas frame (ms)" },
            "no-hud":     { type: "boolean", description: "Hide header/footer/nav elements" },
            settleMs:      { type: "number", description: "Extra settle time before screenshot (ms, default 1200)" },
          },
          required: ["url", "ref"],
        },
      },
      {
        name: "pursr_sweep",
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
        name: "pursr_frames",
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
        name: "pursr_probe",
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
        name: "pursr_audit",
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
        name: "pursr_dom_snapshot",
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
      {
        name: "pursr_check",
        description: "CI visual regression check. Renders a URL and diffs against the stored baseline. Exits 0 if equal, 1 if differs, 2 if no baseline. Use update:true to approve current as new baseline.",
        inputSchema: {
          type: "object",
          properties: {
            url:       { type: "string", description: "Target URL" },
            preset:    { type: "string", description: "Viewport preset" },
            width:     { type: "number", description: "Viewport width" },
            height:    { type: "number", description: "Viewport height" },
            dpr:       { type: "number", description: "Device pixel ratio" },
            full:      { type: "boolean", description: "Full-page screenshot" },
            zoom:      { type: "number", description: "Camera zoom" },
            panX:      { type: "number", description: "Camera pan X" },
            panY:      { type: "number", description: "Camera pan Y" },
            threshold: { type: "number", description: "Pixelmatch threshold 0-1 (default 0.1)" },
            update:    { type: "boolean", description: "Approve current render as the new baseline" },
            out:       { type: "string", description: "Diff output PNG path" },
            project:   { type: "string", description: "Project key (defaults to URL origin+path)" },
          },
          required: ["url"],
        },
      },
    ];
  }

  // ── Tool dispatcher ─────────────────────────────────────────────────

  async _callTool(name, args) {
    switch (name) {
      case "pursr_session_open":  return await this._sessionOpen(args);
      case "pursr_sessions":      return this._text(this.sessions.list());
      case "pursr_snapshot":      return await this._sessionSnapshot(args);
      case "pursr_act":           return await this._sessionAct(args);
      case "pursr_screenshot":    return await this._sessionScreenshot(args);
      case "pursr_inspect":       return await this._sessionInspect(args);
      case "pursr_diagnostics":   return this._sessionDiagnostics(args);
      case "pursr_session_close": return await this._sessionClose(args);
      case "pursr_shoot":        return await this._shoot(args);
      case "pursr_diff":         return await this._diff(args);
      case "pursr_sweep":        return await this._sweep(args);
      case "pursr_frames":       return await this._frames(args);
      case "pursr_probe":        return await this._probe(args);
      case "pursr_audit":        return await this._audit(args);
      case "pursr_dom_snapshot": return await this._domSnapshot(args);
      case "pursr_check":        return await this._check(args);
      default: throw new McpError(-32602, `Unknown tool: ${name}`);
    }
  }

  // ── Tool implementations ────────────────────────────────────────────

  _text(value) {
    return [{ type: "text", text: JSON.stringify(value, null, 2) }];
  }

  _requireSessionId(args) {
    if (!args.sessionId) throw new McpError(-32602, "Missing required: sessionId");
    return args.sessionId;
  }

  async _sessionOpen(args) {
    if (!args.url) throw new McpError(-32602, "Missing required: url");
    const flags = { preset: args.preset, width: args.width, height: args.height, dpr: args.dpr };
    const result = await this.sessions.open({ sessionId: args.sessionId, url: args.url, flags, storageState: args.storageState });
    return this._text(result);
  }

  async _sessionSnapshot(args) {
    const result = await this.sessions.snapshot(this._requireSessionId(args), args);
    return this._text(result);
  }

  async _sessionAct(args) {
    const result = await this.sessions.act(this._requireSessionId(args), args.actions);
    return this._text(result);
  }

  async _sessionScreenshot(args) {
    const result = await this.sessions.screenshot(this._requireSessionId(args), args);
    recordResource({
      kind: "session", id: args.sessionId, name: `session screenshot: ${args.sessionId}`,
      description: result.url, uri: `pursr://session/${encodeURIComponent(args.sessionId)}`,
      mimeType: result.mimeType, file: result.out, meta: { url: result.url, ts: nowIso() },
    });
    return [
      { type: "text", text: JSON.stringify({ sessionId: result.sessionId, out: result.out, url: result.url }, null, 2) },
      { type: "image", data: result.data, mimeType: result.mimeType },
    ];
  }

  async _sessionInspect(args) {
    const result = await this.sessions.inspect(this._requireSessionId(args), args.selector);
    return this._text(result);
  }

  _sessionDiagnostics(args) {
    return this._text(this.sessions.diagnostics(this._requireSessionId(args), { clear: !!args.clear }));
  }

  async _sessionClose(args) {
    return this._text(await this.sessions.close(this._requireSessionId(args)));
  }

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

    recordResource({
      kind: "shoot", id: Date.now().toString(36),
      name: "shoot: " + (flags.preset || "default") + " " + url,
      description: "Screenshot capture",
      uri: "pursr://shoot/" + encodeURIComponent(url + "|" + (flags.preset || "default")),
      mimeType: "image/png",
      file: out, meta: { url, flags, ts: sidecar?.ts },
    });

    const content = [{ type: "text", text: JSON.stringify({ out, meta: sidecar }, null, 2) }];
    if (existsSync(out)) content.push({ type: "image", data: readFileSync(out).toString("base64"), mimeType: "image/png" });
    return content;
  }

  async _diff(args) {
    const { url, ref } = args;
    if (!url) throw new McpError(-32602, "Missing required: url");
    if (!ref) throw new McpError(-32602, "Missing required: ref");
    if (!existsSync(ref)) throw new McpError(-32602, `Reference file not found: ${ref}`);

    const out = args.out || ref.replace(/\.png$/i, "-diff.png");
    if (out) mkdirSync(dirname(out), { recursive: true });
    const threshold = args.threshold ?? 0.1;
    const flags = {};
    for (const [k, v] of Object.entries(args)) {
      if (k !== "url" && k !== "ref" && k !== "out" && k !== "threshold") flags[k] = v;
    }
    const result = await runDiff(url, ref, out, threshold, flags);
    const content = [{ type: "text", text: JSON.stringify(result, null, 2) }];
    if (existsSync(out)) content.push({ type: "image", data: readFileSync(out).toString("base64"), mimeType: "image/png" });
    return content;
  }

  async _sweep(args) {
    if (!args.plan) throw new McpError(-32602, "Missing required: plan");
    if (!existsSync(args.plan)) throw new McpError(-32602, `Plan file not found: ${args.plan}`);
    const summary = await runSweep(args.plan, args.outDir);
    recordResource({
      kind: "sweep", id: summary.name || "sweep",
      name: "sweep: " + (summary.name || "(unnamed)"),
      description: "Sweep plan: " + (summary.steps?.length || 0) + " steps",
      uri: "pursr://sweep/" + encodeURIComponent(summary.name || "sweep"),
      mimeType: "application/json",
      file: (summary.outDir ? join(summary.outDir, "sweep.json") : null),
      meta: { steps: summary.steps?.length || 0, ts: summary.ts },
    });
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

  async _check(args) {
    if (!args.url) throw new McpError(-32602, "Missing required: url");
    const flags = {};
    for (const [k, v] of Object.entries(args)) {
      if (k !== "url" && k !== "threshold" && k !== "update" && k !== "out" && k !== "project") flags[k] = v;
    }
    const result = await runCheck({
      url: args.url,
      flags,
      threshold: args.threshold ?? 0.1,
      update: !!args.update,
      out: args.out,
      project: args.project || null,
    });
    return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  }
}

export { PursrMCPServer, McpError, loadConfig, MCP_VERSION };

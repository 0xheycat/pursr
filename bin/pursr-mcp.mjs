#!/usr/bin/env node
// @purr/visual — MCP server binary.
//
// Runs the pursor MCP stdio server, exposing all capture/audit/sweep
// capabilities as MCP tools for Claude Code, Cursor, Continue, etc.
//
// Usage: pursor-mcp
//   Config via PURSOR_MCP_CONFIG env or ~/.pursor/mcp-config.json
//
//   echo '{"url":"https://example.com"}' | pursor-mcp

import { PursorMCPServer, loadConfig } from "../src/mcp.js";

const config = loadConfig();

// Verbose mode: --verbose or debug env
const verbose = process.argv.includes("--verbose") || !!process.env.PURSOR_DEBUG;
config.verbose = verbose;

const server = new PursorMCPServer(config);
await server.start();

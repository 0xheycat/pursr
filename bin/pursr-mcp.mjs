#!/usr/bin/env node
//  pursr — MCP server binary.
//
// Runs the pursr MCP stdio server, exposing all capture/audit/sweep
// capabilities as MCP tools for Claude Code, Cursor, Continue, etc.
//
// Usage: pursr-mcp
//   Config via PURSR_MCP_CONFIG env or ~/.pursr/mcp-config.json
//
//   echo '{"url":"https://example.com"}' | pursr-mcp

import { PursrMCPServer, loadConfig } from "../src/mcp.js";
import { __PURSR_GET } from "../src/util.js";

const config = loadConfig();

// Verbose mode: --verbose or debug env
const verbose = process.argv.includes("--verbose") || !!__PURSR_GET("PURSR_DEBUG");
config.verbose = verbose;

const server = new PursrMCPServer(config);
await server.start();
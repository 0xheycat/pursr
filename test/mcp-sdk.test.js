import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let webServer;
let baseUrl;
let client;
let outputDir;

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "pursr-sdk-test-"));
  webServer = createServer((req, res) => {
    if (req.url === "/missing") {
      res.writeHead(404).end("missing");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>SDK transport</title></head><body>
      <button id="toggle">Toggle</button><p id="state">idle</p>
      <script>
        console.log("sdk-page-ready");
        document.querySelector("#toggle").addEventListener("click", () => {
          document.querySelector("#state").textContent = "active";
        });
      </script>
    </body></html>`);
  });
  await new Promise((resolveListen, reject) => {
    webServer.listen(0, "127.0.0.1", resolveListen);
    webServer.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${webServer.address().port}`;
});

after(async () => {
  try { await client?.close(); } catch {}
  await new Promise((resolveClose) => webServer?.close(resolveClose));
  rmSync(outputDir, { recursive: true, force: true });
});

function textResult(result) {
  const block = result.content.find((item) => item.type === "text");
  return JSON.parse(block.text);
}

test("official MCP SDK client completes a persistent visual workflow", { timeout: 60_000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [process.env.PURSR_MCP_BIN ? resolve(process.env.PURSR_MCP_BIN) : resolve("bin/pursr-mcp.mjs")],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  client = new Client({ name: "pursr-sdk-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const listed = await client.listTools();
  assert.equal(listed.tools.length, 16);
  assert.ok(listed.tools.some((tool) => tool.name === "pursr_screenshot"));

  const opened = textResult(await client.callTool({
    name: "pursr_session_open",
    arguments: { sessionId: "sdk-test", url: baseUrl, width: 800, height: 600, visual: true },
  }));
  assert.equal(opened.title, "SDK transport");
  assert.equal(opened.visual, true);

  const acted = textResult(await client.callTool({
    name: "pursr_act",
    arguments: { sessionId: "sdk-test", actions: [{ type: "click", selector: "#toggle" }] },
  }));
  assert.equal(acted.failed, false);
  assert.ok(acted.trace[0].cursor);

  const snapshot = textResult(await client.callTool({
    name: "pursr_snapshot",
    arguments: { sessionId: "sdk-test", selector: "body", maxNodes: 20 },
  }));
  assert.ok(snapshot.nodes.some((node) => node.text === "active"));

  const screenshot = await client.callTool({
    name: "pursr_screenshot",
    arguments: { sessionId: "sdk-test", out: join(outputDir, "session.png") },
  });
  const image = screenshot.content.find((item) => item.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.ok(image?.data.length > 100);

  const diagnostics = textResult(await client.callTool({ name: "pursr_diagnostics", arguments: { sessionId: "sdk-test" } }));
  assert.ok(diagnostics.console.some((entry) => entry.text === "sdk-page-ready"));

  const resources = await client.listResources();
  assert.ok(resources.resources.some((resource) => resource.uri === "pursr://session/sdk-test"));

  const closed = textResult(await client.callTool({ name: "pursr_session_close", arguments: { sessionId: "sdk-test" } }));
  assert.equal(closed.closed, true);
});

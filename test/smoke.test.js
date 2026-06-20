// Smoke test: spins up a Node static server, runs CLI against it.
// Uses a unique port to isolate parallel runs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

// --- unique output dir per test run ---
const runId = "purr-v-smoke-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
const out = join(tmpdir(), runId);
mkdirSync(out, { recursive: true });

// --- static page server ---
const staticDir = join(out, "site");
mkdirSync(staticDir, { recursive: true });
const html = `<!doctype html><html><head><title>pursr smoke</title></head><body style="background:#def">
<h1>pursr smoke</h1>
<button id="go">Click me</button>
<p id="out" style="display:none">clicked</p>
<script>
document.getElementById("go").addEventListener("click", () => {
  document.getElementById("out").style.display = "block";
});
</script>
</body></html>`;
writeFileSync(join(staticDir, "index.html"), html);

const port = 8765 + Math.floor(Math.random() * 1000);
let server;

function serveFile(req, res) {
  let p = req.url === "/" ? "/index.html" : req.url;
  const filePath = join(staticDir, p);
  if (!filePath.startsWith(staticDir)) { res.writeHead(403); res.end(); return; }
  try {
    const data = readFileSync(filePath);
    const ext = p.split(".").pop();
    const mime = { html: "text/html", png: "image/png", js: "application/javascript" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
}

before(() => new Promise((resolve, reject) => {
  server = createServer(serveFile).listen(port, () => resolve());
  server.on("error", reject);
}));

after(() => new Promise(r => { if (server) server.close(r); }));

// --- CLI helper ---
function cli(args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", ["bin/pursr.mjs", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    let stdout = "", stderr = "";
    p.stdout.on("data", d => stdout += d.toString());
    p.stderr.on("data", d => stderr += d.toString());
    p.on("error", reject);
    p.on("close", code => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nstdout: ${stdout}\nstderr: ${stderr}`)); }
      } else { reject(new Error(`exit ${code}: ${stderr || stdout.slice(0, 200)}`)); }
    });
  });
}

// --- tests ---
test("viewports list", async () => {
  const r = await cli(["viewports"]);
  assert.ok(Array.isArray(r));
  assert.ok(r.length >= 10, `expected >=10 viewports, got ${r.length}`);
});

test("probe returns status 200", async () => {
  const r = await cli(["probe", `http://localhost:${port}/`]);
  assert.equal(r.status, 200);
  assert.equal(r.title, "pursr smoke");
});

test("shot captures PNG", async () => {
  const shotPath = join(out, "shot.png");
  const r = await cli(["shot", `http://localhost:${port}/`, shotPath]);
  assert.equal(r.status, 200);
  assert.ok(existsSync(shotPath), "PNG file should exist");
});

test("eval returns page data", async () => {
  const r = await cli(["eval", `http://localhost:${port}/`, "document.querySelector('h1').textContent"]);
  assert.equal(r.result, "pursr smoke");
});

test("click returns clicked:true", async () => {
  const r = await cli(["click", `http://localhost:${port}/`, "#go", join(out, "click.png")]);
  assert.equal(r.clicked, true);
  assert.equal(r.selector, "#go");
});

test("shoot writes sidecar JSON", async () => {
  const shotPath = join(out, "shoot.png");
  const r = await cli(["shoot", `http://localhost:${port}/`, shotPath, "--preset", "desktop-1280"]);
  assert.equal(r.status, 200);
  assert.ok(existsSync(shotPath), "PNG should exist");
  assert.ok(existsSync(shotPath.replace(/\.png$/, ".json")), "sidecar JSON should exist");
});

test("shoot error returns error object not throw", async () => {
  const r = await cli(["shoot", "http://localhost:1/nonexistent", join(out, "fail.png")]);
  // runShoot returns error instead of throwing now
  assert.ok(r.error || r.status >= 400 || !r.title, "should have error or fail status");
});

test("spike: single frame capture", async () => {
  const r = await cli(["frames", `http://localhost:${port}/`, "3", "50", out]);
  assert.ok(r.files?.length >= 1, "should capture at least 1 frame");
});

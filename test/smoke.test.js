// Tiny self-test: a static page is captured by the CLI in <10s.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const out = join(tmpdir(), "purr-visual-smoke");
try { rmSync(out, { recursive: true, force: true }); } catch {}
mkdirSync(out, { recursive: true });

const staticDir = join(out, "site");
mkdirSync(staticDir, { recursive: true });
const html = `<!doctype html><html><body style="background:#def">
<h1>purr-visual smoke</h1>
<button id="go">Click me</button>
<p id="out" style="display:none">clicked</p>
<script>
document.getElementById("go").addEventListener("click", () => {
  document.getElementById("out").style.display = "block";
});
</script>
</body></html>`;
const { writeFileSync } = await import("node:fs");
writeFileSync(join(staticDir, "index.html"), html);

const port = 8765 + Math.floor(Math.random() * 100);
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: staticDir, stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));

const cli = (args) => new Promise((resolve, reject) => {
  const p = spawn("node", ["bin/purr-visual.mjs", ...args], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", d => out += d.toString());
  p.stderr.on("data", d => err += d.toString());
  p.on("close", code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${code}: ${err}`)));
});

try {
  test("viewports list", async () => {
    const r = await cli(["viewports"]);
    assert.ok(Array.isArray(r));
    assert.ok(r.length >= 10);
  });

  test("probe + shot", async () => {
    const probe = await cli(["probe", `http://localhost:${port}/index.html`]);
    assert.equal(probe.status, 200);
    const shotPath = join(out, "shot.png");
    const r = await cli(["shot", `http://localhost:${port}/index.html`, shotPath]);
    assert.equal(r.status, 200);
    assert.ok(existsSync(shotPath));
  });

  test("eval returns page data", async () => {
    const r = await cli(["eval", `http://localhost:${port}/index.html`, "document.querySelector('h1').textContent"]);
    assert.equal(r.result, "purr-visual smoke");
  });

  test("click then eval sees the click", async () => {
    await cli(["click", `http://localhost:${port}/index.html`, "#go", join(out, "click.png")]);
    const r = await cli(["eval", `http://localhost:${port}/index.html`, "getComputedStyle(document.getElementById('out')).display"]);
    assert.equal(r.result, "block");
  });

  test("shoot writes sidecar", async () => {
    const shotPath = join(out, "shoot.png");
    const r = await cli(["shoot", `http://localhost:${port}/index.html`, shotPath, "--preset", "desktop-1280"]);
    assert.equal(r.status, 200);
    assert.ok(existsSync(shotPath));
    assert.ok(existsSync(shotPath.replace(/\.png$/, ".json")), "sidecar JSON should exist");
  });
} finally {
  server.kill();
}
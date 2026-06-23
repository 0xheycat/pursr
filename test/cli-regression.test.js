import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

let server;
let baseUrl;
let outputDir;

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/pursr.mjs", ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, PURSR_NO_UPDATE_NOTIFIER: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function jsonResult(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "pursr-cli-regression-"));
  server = createServer((req, res) => {
    const variant = req.url?.includes("variant=shoot") ? "#8a2be2" : "#ffffff";
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>CLI Regression</title></head><body style="background:${variant}">
      <button id="go">Continue</button><input id="name"><div id="hover">Hover</div>
      <script>document.querySelector('#go').onclick=()=>document.body.dataset.clicked='yes';</script>
    </body></html>`);
  });
  await new Promise((resolveListen, reject) => {
    server.listen(0, "127.0.0.1", resolveListen);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(outputDir, { recursive: true, force: true });
});

test("CLI accepts flags before positionals and honors output paths", { timeout: 120_000 }, async () => {
  const shot = join(outputDir, "nested", "shot.png");
  const shotResult = jsonResult(await runCli(["shot", "--preset", "desktop-1280", baseUrl, "--out", shot]));
  assert.equal(shotResult.out, shot);
  assert.ok(existsSync(shot));
  assert.equal(shotResult.viewport.name, "desktop-1280");

  const shootOut = join(outputDir, "shoot.png");
  const shootResult = jsonResult(await runCli(["shoot", "--preset", "desktop-1280", `${baseUrl}/?variant=shoot`, "--out", shootOut]));
  assert.equal(shootResult.out, shootOut);
  assert.ok(existsSync(shootOut));
  assert.notDeepEqual(readFileSync(shootOut), readFileSync(shot), "shoot must capture fresh page content");

  const fullDir = join(outputDir, "full");
  const fullResult = jsonResult(await runCli(["full", "--out-dir", fullDir, "--preset", "desktop-1280", baseUrl]));
  assert.equal(fullResult.out, join(fullDir, "full.png"));
  assert.ok(existsSync(fullResult.out));

  const evalOut = join(outputDir, "eval.png");
  const evalResult = jsonResult(await runCli(["eval", "--preset", "desktop-1280", baseUrl, "document.title", "--out", evalOut]));
  assert.equal(evalResult.result, "CLI Regression");
  assert.ok(existsSync(evalOut));

  const clickOut = join(outputDir, "click.png");
  const clickResult = jsonResult(await runCli(["click", "--preset", "desktop-1280", baseUrl, "#go", "--out", clickOut]));
  assert.equal(clickResult.selector, "#go");
  assert.ok(existsSync(clickOut));

  const typeOut = join(outputDir, "type.png");
  const typeResult = jsonResult(await runCli(["type", "--preset", "desktop-1280", baseUrl, "#name", "hello", "--out", typeOut]));
  assert.equal(typeResult.text, "hello");
  assert.ok(existsSync(typeOut));

  const hoverOut = join(outputDir, "hover.png");
  const hoverResult = jsonResult(await runCli(["hover", "--preset", "desktop-1280", baseUrl, "#hover", "--out", hoverOut]));
  assert.equal(hoverResult.selector, "#hover");
  assert.ok(existsSync(hoverOut));

  const actionsPath = join(outputDir, "actions.json");
  writeFileSync(actionsPath, JSON.stringify([{ op: "click", selector: "#go" }]));
  const seqOut = join(outputDir, "seq.png");
  const seqResult = jsonResult(await runCli(["seq", "--preset", "desktop-1280", baseUrl, actionsPath, "--out", seqOut]));
  assert.equal(seqResult.failed, false);
  assert.ok(existsSync(seqOut));

  const diffOut = join(outputDir, "diff.png");
  const diffResult = jsonResult(await runCli(["diff", "--preset", "desktop-1280", baseUrl, shot, "--out", diffOut]));
  assert.equal(diffResult.refPath, shot);
  assert.ok(existsSync(diffOut));

  const help = jsonResult(await runCli(["report", "--help"]));
  assert.match(help.usage, /pursr report/);

  const sweepPlan = join(outputDir, "sweep-plan.json");
  const sweepDir = join(outputDir, "sweep");
  writeFileSync(sweepPlan, JSON.stringify({ name: "cli", base: baseUrl, steps: [{ name: "home", shoot: { preset: "desktop-1280" } }] }));
  const sweepResult = jsonResult(await runCli(["sweep", "--out-dir", sweepDir, sweepPlan]));
  assert.equal(sweepResult.outDir, sweepDir);
  assert.ok(existsSync(join(sweepDir, "00-home.png")));
});

test("doctor and setup commands are available", async () => {
  const doctor = await runCli(["doctor", "--json"]);
  assert.ok([0, 1].includes(doctor.code), doctor.stderr || doctor.stdout);
  const doctorJson = JSON.parse(doctor.stdout);
  assert.ok(Array.isArray(doctorJson.checks));

  const setup = await runCli(["setup", "--json"]);
  assert.ok([0, 1].includes(setup.code), setup.stderr || setup.stdout);
  const setupJson = JSON.parse(setup.stdout);
  assert.ok(Array.isArray(setupJson.recommended));
});

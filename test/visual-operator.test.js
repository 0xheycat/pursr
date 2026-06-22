import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { BrowserSessionManager } from "../src/session.js";
import { launch } from "../src/runway.js";

let server;
let baseUrl;
let outputDir;

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "pursr-visual-operator-"));
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>Visual Operator</title><style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #152238; color: white; font-family: sans-serif; }
      button { width: 220px; height: 80px; border: 0; border-radius: 14px; background: #35a76f; color: white; font-size: 22px; font-weight: 700; }
    </style></head><body><button id="ship">Ship Visual Operator</button>
      <script>document.querySelector('#ship').onclick = () => { document.querySelector('#ship').textContent = 'Shipped'; };</script>
    </body></html>`);
  });
  await new Promise((resolveListen, reject) => {
    server.listen(0, "127.0.0.1", resolveListen);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose) => server?.close(resolveClose));
  rmSync(outputDir, { recursive: true, force: true });
});

test("Visual Operator cursor, target, and click marker render into PNG", { timeout: 60_000 }, async () => {
  const manager = new BrowserSessionManager({ outputDir });
  try {
    const opened = await manager.open({
      sessionId: "visual-test",
      url: baseUrl,
      flags: { width: 800, height: 600, visual: true, operatorColor: "#ff2ea6" },
    });
    assert.equal(opened.visual, true);
    assert.equal(opened.mode, "headless");

    const acted = await manager.act("visual-test", [
      { type: "move", x: 100, y: 100, durationMs: 10 },
      { type: "click", selector: "#ship", label: "click: ship", color: "</style><img src=x>", durationMs: 10 },
    ]);
    assert.equal(acted.failed, false);
    assert.equal(acted.trace[1].cursor.x, 400);
    assert.equal(acted.trace[1].cursor.y, 300);

    const page = manager.get("visual-test").page;
    const visualState = await page.evaluate(() => ({
      cursor: !!document.querySelector("#__pursr_cursor__"),
      target: document.querySelectorAll(".__pursr_target__").length,
      click: document.querySelectorAll(".__pursr_click__").length,
      injected: document.querySelectorAll("img").length,
      text: document.querySelector("#ship")?.textContent,
    }));
    assert.deepEqual(visualState, { cursor: true, target: 1, click: 1, injected: 0, text: "Shipped" });

    const shot = await manager.screenshot("visual-test", { out: join(outputDir, "operator.png") });
    const png = PNG.sync.read(readFileSync(shot.out));
    let accentPixels = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (r > 235 && g >= 25 && g < 85 && b > 140) accentPixels++;
    }
    assert.ok(accentPixels > 150, `expected visible cursor/annotation pixels, got ${accentPixels}`);

    const cleared = await manager.act("visual-test", [{ type: "clearAnnotations", keepCursor: true }]);
    assert.equal(cleared.failed, false);
    const remaining = await page.evaluate(() => ({
      cursor: !!document.querySelector("#__pursr_cursor__"),
      annotations: document.querySelectorAll(".__pursr_target__, .__pursr_click__").length,
    }));
    assert.deepEqual(remaining, { cursor: true, annotations: 0 });
  } finally {
    await manager.closeAll();
  }
});

test("CDP mode attaches to Chrome and disconnects without closing its owner", { timeout: 60_000 }, async () => {
  const portProbe = createServer();
  await new Promise((resolveListen) => portProbe.listen(0, "127.0.0.1", resolveListen));
  const cdpPort = portProbe.address().port;
  await new Promise((resolveClose) => portProbe.close(resolveClose));

  const owner = await launch({ headless: true, args: [`--remote-debugging-port=${cdpPort}`] });
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  const manager = new BrowserSessionManager({ outputDir });
  try {
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try { ready = (await fetch(`${cdpUrl}/json/version`)).ok; } catch {}
      if (!ready) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.equal(ready, true, "Chrome DevTools endpoint should become available");

    const opened = await manager.open({
      sessionId: "cdp-test",
      url: baseUrl,
      flags: { mode: "cdp", cdpUrl, visual: true, width: 800, height: 600 },
    });
    assert.equal(opened.mode, "cdp");
    assert.equal(opened.visual, true);
    assert.equal((await manager.act("cdp-test", [{ type: "hover", selector: "#ship", durationMs: 10 }])).failed, false);
    await manager.close("cdp-test");
    assert.equal(owner.isConnected(), true, "disconnecting pursr must not close the owner browser");
  } finally {
    await manager.closeAll();
    await owner.close();
  }
});

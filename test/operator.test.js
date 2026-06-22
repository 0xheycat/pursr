import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOperator } from "../src/operator.js";

let server;
let baseUrl;
let outputDir;

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "pursr-operator-"));
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body style="margin:0;background:#172033">
      <button id="target" style="position:absolute;left:40px;top:40px;width:160px;height:80px">Click me</button>
      <div id="drag" style="position:absolute;left:60px;top:220px;width:80px;height:80px;background:#36c"></div>
      <script>
        const target = document.querySelector('#target');
        target.addEventListener('click', () => target.dataset.clicked = String(Number(target.dataset.clicked || 0) + 1));
        target.addEventListener('dblclick', () => target.dataset.doubled = 'yes');
        const drag = document.querySelector('#drag');
        drag.addEventListener('mousedown', () => drag.dataset.dragging = 'yes');
        document.addEventListener('mousemove', (event) => { if (drag.dataset.dragging === 'yes') drag.dataset.lastX = String(event.clientX); });
        document.addEventListener('mouseup', () => { if (drag.dataset.dragging === 'yes') drag.dataset.dragged = 'yes'; delete drag.dataset.dragging; });
        document.addEventListener('keydown', (event) => { if (event.key === 'Shift') document.body.dataset.shiftDown = 'yes'; });
        document.addEventListener('keyup', (event) => { if (event.key === 'Shift') document.body.dataset.shiftUp = 'yes'; });
      </script>
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

test("operator records WebM and handles selector, coordinate, and drag actions", { timeout: 60_000 }, async () => {
  const screenshot = join(outputDir, "final.png");
  const result = await runOperator({
    url: baseUrl,
    out: screenshot,
    outputDir,
    sessionId: "recording",
    flags: { width: 640, height: 480, visual: true, recordVideoDir: join(outputDir, "video") },
    actions: [
      { type: "click", selector: "#target", durationMs: 10 },
      { type: "doubleClick", x: 120, y: 80, durationMs: 10 },
      { type: "drag", fromX: 100, fromY: 260, toX: 320, toY: 260, steps: 8, durationMs: 10 },
      { type: "keyDown", key: "Shift" },
      { type: "keyUp", key: "Shift" },
      { type: "eval", js: "({ doubled: document.querySelector('#target').dataset.doubled, dragged: document.querySelector('#drag').dataset.dragged, shiftDown: document.body.dataset.shiftDown, shiftUp: document.body.dataset.shiftUp })" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.trace.length, 6);
  assert.deepEqual(result.trace[5].result, { doubled: "yes", dragged: "yes", shiftDown: "yes", shiftUp: "yes" });
  assert.equal(result.screenshot, screenshot);
  assert.ok(existsSync(result.screenshot));
  assert.ok(result.video && existsSync(result.video));
  assert.ok(statSync(result.video).size > 1000, "recorded WebM should contain video data");
  assert.deepEqual([...readFileSync(result.video).subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the page and offline shell use the current versioned application modules", async () => {
  const [index, app, worker] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/service-worker.js", import.meta.url), "utf8")
  ]);

  assert.match(index, /src\/app\.js\?v=7/);
  assert.match(worker, /src\/app\.js\?v=7/);
  assert.match(app, /core\/webrtc-transport\.js\?v=4/);
  assert.match(worker, /core\/webrtc-transport\.js\?v=4/);
  assert.match(worker, /opwebview-shell-v11/);
  assert.match(app, /core\/device-discovery\.js\?v=2/);
  assert.match(worker, /core\/device-discovery\.js\?v=2/);
  assert.match(worker, /widgets\/widget-catalog\.js/);
  assert.match(worker, /widgets\/layout-presets\.js/);
  assert.match(app, /updateViaCache:\s*"none"/);
});

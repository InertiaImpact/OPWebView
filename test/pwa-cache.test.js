import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every statically imported app module is included in the atomic offline release", async () => {
  const root = new URL("../public/", import.meta.url);
  const worker = await readFile(new URL("service-worker.js", root), "utf8");
  const shell = worker.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1];
  const base = "https://offline.test/";
  const cached = new Set([...shell.matchAll(/"([^"]+)"/g)].map((match) => new URL(match[1], base).href));
  const pending = [new URL("./src/app.js?v=30", base)];
  const visited = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    assert.ok(cached.has(url.href), `${url.pathname}${url.search} must be cached for offline use`);
    const source = await readFile(new URL(url.pathname.slice(1), root), "utf8");
    for (const match of source.matchAll(/(?:^|\n)import[\s\S]*?from\s+"([^"]+)"/g)) pending.push(new URL(match[1], url));
  }
});

test("the page and offline shell use the current versioned application modules", async () => {
  const [index, app, worker] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/service-worker.js", import.meta.url), "utf8")
  ]);

  assert.match(index, /src\/app\.js\?v=30/);
  assert.match(worker, /src\/app\.js\?v=30/);
  assert.match(app, /core\/webrtc-transport\.js\?v=6/);
  assert.match(worker, /core\/webrtc-transport\.js\?v=6/);
  assert.match(worker, /const CACHE_VERSION = 43/);
  assert.match(index, /styles\.css\?v=18/);
  assert.match(worker, /styles\.css\?v=18/);
  assert.match(worker, /widgets\/indicator-smoothing\.js/);
  assert.match(app, /core\/device-discovery\.js\?v=5/);
  assert.match(worker, /core\/device-discovery\.js\?v=5/);
  assert.match(app, /core\/connection-manager\.js\?v=6/);
  assert.match(worker, /core\/connection-manager\.js\?v=6/);
  assert.match(index, /vendor\/qrcode-generator\.js\?v=1/);
  assert.match(worker, /core\/diagnostic-log\.js\?v=10/);
  assert.match(worker, /core\/viewport-controller\.js/);
  assert.match(worker, /widgets\/widget-graphs\.js/);
  assert.match(worker, /vendor\/qrcode-generator\.js\?v=1/);
  assert.match(worker, /widgets\/widget-catalog\.js/);
  assert.match(worker, /widgets\/layout-presets\.js/);
  assert.match(app, /updateViaCache:\s*"none"/);
});

test("generic steering-wheel icons are used by the page, manifest, and offline cache", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const worker = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.match(index, /icons\/web-wheel-192\.png/);
  assert.doesNotMatch(index, /icons\/icon-192\.png/);
  for (const size of [192, 512]) {
    const path = `./icons/web-wheel-${size}.png`;
    assert.ok(manifest.icons.some((icon) => icon.src === path && icon.sizes === `${size}x${size}`));
    assert.ok(worker.includes(path));
    const png = await readFile(new URL(`../public/icons/web-wheel-${size}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

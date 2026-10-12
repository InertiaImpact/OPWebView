import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DevWatermark } from "../public/src/core/dev-watermark.js";

const live = { connected: true, onRoad: true, demo: false, hasStream: true, ready: true };

function fixture() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const classes = new Set();
  const element = { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const watermark = new DevWatermark(element, {
    setTimer(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimer(id) { timers.delete(id); }
  });
  return { watermark, timers, faded: () => classes.has("dev-watermark-faded"),
    advance(ms) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    } };
}

test("DEV fades after ten seconds of live video, unaffected by telemetry updates", () => {
  const f = fixture();
  f.watermark.update(live);
  f.advance(5000);
  f.watermark.update(live);
  assert.equal(f.timers.size, 1);
  f.advance(4999);
  assert.equal(f.faded(), false);
  f.advance(1);
  assert.equal(f.faded(), true);
  f.watermark.update(live);
  assert.equal(f.faded(), true);
  assert.equal(f.timers.size, 0);
});

test("demo, off-road, disconnected and unplayable video keep DEV visible", () => {
  for (const changes of [{ demo: true }, { onRoad: false }, { connected: false }, { hasStream: false }, { ready: false }]) {
    const f = fixture();
    f.watermark.update({ ...live, ...changes });
    f.advance(20_000);
    assert.equal(f.faded(), false);
    assert.equal(f.timers.size, 0);
  }
});

test("leaving live mode cancels or resets the countdown for the next session", () => {
  const f = fixture();
  f.watermark.update(live);
  f.advance(9000);
  f.watermark.update({ ...live, onRoad: false });
  assert.equal(f.timers.size, 0);
  f.advance(5000);
  assert.equal(f.faded(), false);
  f.watermark.update(live);
  f.advance(10_000);
  assert.equal(f.faded(), true);
  f.watermark.update({ ...live, connected: false });
  assert.equal(f.faded(), false);
  f.watermark.update(live);
  f.advance(9999);
  assert.equal(f.faded(), false);
  // A fresh page starts with a visible label rather than restoring a hidden setting.
  assert.equal(fixture().faded(), false);
});

test("stable pages without a DEV element do not schedule a fade", () => {
  const watermark = new DevWatermark(null, { setTimer: () => assert.fail("No timer expected") });
  watermark.update(live);
});

test("page and manifest keep their matching stable/development identity", async () => {
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  if (/data-channel="dev"/.test(page)) {
    assert.match(page, /inset: 50% auto auto 50%/);
    assert.match(page, /pointer-events: none/);
    assert.match(page, /transition: opacity 600ms ease/);
    assert.match(page, /\.dev-watermark\.dev-watermark-faded \{ opacity: 0; \}/);
    assert.match(page, /class="dev-watermark"[^>]*>DEV<\/div>/);
    assert.match(page, /<title>OP WebView DEV<\/title>/);
    assert.equal(manifest.name, "OP WebView DEV");
  } else {
    assert.doesNotMatch(page, /dev-watermark|Development version|OP WebView DEV/);
    assert.match(page, /<title>OP WebView<\/title>/);
    assert.equal(manifest.name, "OP WebView");
  }
  assert.equal(manifest.short_name, manifest.name);
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
});

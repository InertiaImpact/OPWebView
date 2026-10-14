import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { compactDiagnosticPayload, fullLogQrPages } from "../public/src/core/diagnostic-log.js";

test("compact diagnostics stay within QR capacity and retain the newest failure", () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({
    at: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    level: index === 59 ? "error" : "info",
    source: "webrtc",
    message: `${index} ${"connection progress ".repeat(20)}`
  }));
  const encoded = compactDiagnosticPayload(entries, { page: "https://example.test", userAgent: "test" }, 1200);
  const parsed = JSON.parse(encoded);
  assert.ok(new TextEncoder().encode(encoded).length <= 1200);
  assert.equal(parsed.events.at(-1).l, "error");
  assert.match(parsed.events.at(-1).m, /^59 /);
});

test("QR keeps interruption evidence after a successful reconnect pushes it out of recent progress", () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    at: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    level: index === 4 ? "warn" : "info", source: "webrtc",
    message: index === 4 ? "Link peer: disconnected; ICE disconnected" : "Camera and telemetry are live.",
    ...(index === 4 ? { detail: { peer: "disconnected", ice: "disconnected", hidden: false, online: true } } : {})
  }));
  const encoded = compactDiagnosticPayload(entries, { page: "https://inertiaimpact.github.io/OPWebView/dev/", userAgent: "x".repeat(220), viewport: "1199x498", online: true, secure: true }, 1200);
  const parsed = JSON.parse(encoded);
  assert.ok(new TextEncoder().encode(encoded).length <= 1200);
  assert.equal(parsed.events[0].l, "warn");
  assert.equal(parsed.events[0].d.ice, "disconnected");
  assert.equal(parsed.events.at(-1).t, entries.at(-1).at);
});

test("large issue and recovery entries fit a QR without dropping either", () => {
  const entries = ["warn", "info"].map((level, index) => ({
    at: new Date(1_700_000_000_000 + index * 1000).toISOString(), level,
    source: "webrtc", message: "Camera and telemetry progress ".repeat(20), detail: "abc ".repeat(100)
  }));
  const encoded = compactDiagnosticPayload(entries, { page: "https://inertiaimpact.github.io/OPWebView/dev/", userAgent: "x".repeat(220), online: true, secure: true }, 1200);
  assert.ok(new TextEncoder().encode(encoded).length <= 1200);
  assert.equal(JSON.parse(encoded).events.length, 2);
});

test("multi-byte failure/recovery text still respects the QR byte budget", () => {
  const entries = ["error", "info"].map((level, index) => ({
    at: new Date(1_700_000_000_000 + index * 1000).toISOString(), level,
    source: "webrtc", message: "🚘".repeat(240), detail: "🚘".repeat(240)
  }));
  const encoded = compactDiagnosticPayload(entries, { page: "https://inertiaimpact.github.io/OPWebView/dev/", online: true, secure: true }, 1200);
  assert.ok(new TextEncoder().encode(encoded).length <= 1200);
  assert.equal(JSON.parse(encoded).events.length, 2);
});

test("full-log QR pages reconstruct the exact log, including Unicode and JSON escapes", () => {
  const text = Array.from({ length: 100 }, (_, index) =>
    `${index} [INFO] webrtc: Camera 🚘 日本語 \\"data\\"\n${"long connection detail ".repeat(10)}`).join("\n");
  const pages = fullLogQrPages(text);
  const decoded = pages.map(JSON.parse);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => new TextEncoder().encode(page).length <= 1200));
  assert.ok(decoded.every((part, index) => part.format === "opwebview-log-chunk-v1" &&
    part.part === index + 1 && part.total === pages.length && part.id === decoded[0].id));
  assert.equal(decoded.map((part) => part.text).join(""), text, "no event or character is truncated");
  assert.ok(decoded.every((part) => !/[\uD800-\uDBFF]$/.test(part.text)), "surrogate pairs never split between pages");
});

test("empty full log has one page and impossible QR budgets fail explicitly", () => {
  const pages = fullLogQrPages("");
  assert.equal(pages.length, 1); assert.equal(JSON.parse(pages[0]).text, "");
  assert.throws(() => fullLogQrPages("abc", 10), /too small/);
});

test("full-log QR pages are accepted by the same UTF-8 QR encoder as the summary", async () => {
  const source = await readFile(new URL("../public/vendor/qrcode-generator.js", import.meta.url), "utf8");
  const context = {};
  vm.runInNewContext(`${source}; this.factory = qrcode;`, context);
  const factory = context.factory;
  factory.stringToBytes = factory.stringToBytesFuncs["UTF-8"];
  for (const page of fullLogQrPages("Connection 🚘 日本語 \"recovered\"\n".repeat(50))) {
    const qr = factory(0, "M"); qr.addData(page, "Byte"); qr.make();
    assert.match(qr.createSvgTag(4, 4), /<svg[^>]+>/);
  }
});

test("detailed QR navigation freezes its snapshot and summary mode cannot go out of bounds", async () => {
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  const block = app.match(/elements\.diagnosticsQrMode\.addEventListener[\s\S]*?(?=\nelements\.demo\.addEventListener)/)[0];
  const listeners = {};
  const control = (name) => ({ addEventListener(_type, callback) { listeners[name] = callback; } });
  let text = "original log", renders = 0;
  const context = { elements: { diagnosticsQrMode: control("mode"), diagnosticsQrPrevious: control("previous"), diagnosticsQrNext: control("next") },
    diagnostics: { text: () => text }, fullLogQrPages: (value) => [value + " part1", value + " part2"],
    detailedQrPages: null, detailedQrIndex: 0, renderDiagnostics() { renders++; } };
  vm.runInNewContext(block, context);
  listeners.next(); assert.equal(renders, 0);
  listeners.mode(); text = "new event arrived";
  listeners.next(); assert.equal(context.detailedQrPages[1], "original log part2");
  listeners.next(); assert.equal(context.detailedQrIndex, 1);
  listeners.previous(); listeners.previous(); assert.equal(context.detailedQrIndex, 0);
  listeners.mode(); assert.equal(context.detailedQrPages, null);
  listeners.mode(); assert.equal(context.detailedQrPages[0], "new event arrived part1");
});

test("vendored QR generator produces an SVG from diagnostic JSON", async () => {
  const source = await readFile(new URL("../public/vendor/qrcode-generator.js", import.meta.url), "utf8");
  const context = {};
  vm.runInNewContext(`${source}; this.qrcodeFactory = qrcode;`, context);
  const qr = context.qrcodeFactory(0, "M");
  qr.addData('{"status":"failed","stage":"schema"}');
  qr.make();
  assert.match(qr.createSvgTag(4, 4), /<svg[^>]+>/);
});

test("opening the connection dialog does not focus the host field", async () => {
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /elements\.host\.focus/);
  assert.match(app, /connectionDialog\.querySelector\("\.close-button"\)/);
});

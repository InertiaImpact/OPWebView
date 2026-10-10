import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { compactDiagnosticPayload } from "../public/src/core/diagnostic-log.js";

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

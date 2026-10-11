import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dev is marked centrally without intercepting touch or mouse input", async () => {
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(page, /data-channel="dev"/);
  assert.match(page, /inset: 50% auto auto 50%/);
  assert.match(page, /pointer-events: none/);
  assert.match(page, /class="dev-watermark"[^>]*>DEV<\/div>/);
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "OP WebView DEV");
  assert.equal(manifest.scope, "./");
});

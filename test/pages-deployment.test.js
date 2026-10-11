import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packagePages } from "../scripts/package-pages.mjs";

test("Pages artifact contains stable and dev and refuses to overwrite output", async () => {
  const root = await mkdtemp(join(tmpdir(), "opwebview-pages-test-"));
  const stable = join(root, "stable"), dev = join(root, "dev"), output = join(root, "site");
  await mkdir(stable); await mkdir(dev);
  await writeFile(join(stable, "index.html"), "stable");
  await writeFile(join(dev, "index.html"), "dev");
  await packagePages(stable, dev, output);
  assert.equal(await readFile(join(output, "index.html"), "utf8"), "stable");
  assert.equal(await readFile(join(output, "dev/index.html"), "utf8"), "dev");
  await assert.rejects(packagePages(stable, dev, output), /new directory/);
});

test("development storage is isolated without changing stable keys", async () => {
  const previous = globalThis.document;
  try {
    globalThis.document = { documentElement: { dataset: {} } };
    const stable = await import("../public/src/core/app-channel.js?test-stable");
    assert.equal(stable.storageKey("opwebview.layout.v2"), "opwebview.layout.v2");
    globalThis.document.documentElement.dataset.channel = "dev";
    const dev = await import("../public/src/core/app-channel.js?test-dev");
    assert.equal(dev.storageKey("opwebview.layout.v2"), "opwebview.dev.layout.v2");
  } finally { globalThis.document = previous; }
});

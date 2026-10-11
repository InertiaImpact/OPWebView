import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");
const base = "https://example.test/OPWebView/";

function worker({ failInstall = false, root = base, cacheKeys = [] } = {}) {
  const handlers = {};
  const entries = new Map();
  let networkCalls = 0;
  let skipped = false;
  const deleted = [];
  const opened = [];
  const cache = {
    async addAll(requests) {
      assert.ok(requests.every((request) => request.cache === "reload"));
      if (failInstall) throw new Error("No internet");
      for (const request of requests) entries.set(request.url, new Response(`release:${request.url}`));
    },
    async match(request) {
      const url = typeof request === "string" ? new URL(request, root).href : request.url;
      return entries.get(url)?.clone();
    }
  };
  const context = {
    self: {
      location: new URL(root),
      clients: { claim: async () => {} },
      skipWaiting: async () => { skipped = true; },
      addEventListener: (name, callback) => { handlers[name] = callback; }
    },
    caches: { open: async (name) => { opened.push(name); return cache; }, keys: async () => cacheKeys, delete: async (name) => { deleted.push(name); return true; } },
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, root), options); }
    },
    URL, Response,
    fetch: async () => { networkCalls++; throw new Error("Offline"); }
  };
  vm.runInNewContext(source, context);
  return {
    deleted, opened,
    async activate() {
      let promise;
      handlers.activate({ waitUntil(value) { promise = value; } });
      await promise;
    },
    async install() {
      let promise;
      handlers.install({ waitUntil(value) { promise = value; } });
      await promise;
    },
    async request(path, mode = "cors") {
      let promise;
      handlers.fetch({ request: { url: new URL(path, root).href, method: "GET", mode }, respondWith(value) { promise = value; } });
      return promise;
    },
    get networkCalls() { return networkCalls; },
    get skipped() { return skipped; }
  };
}

test("offline navigation with a new query and scripts use the same installed release", async () => {
  const runtime = worker();
  await runtime.install();
  const page = await runtime.request("?v=another-release", "navigate");
  const script = await runtime.request("src/app.js?v=12");
  assert.match(await page.text(), /index\.html/);
  assert.match(await script.text(), /app\.js\?v=12/);
  assert.equal(runtime.networkCalls, 0);
  assert.equal(runtime.skipped, false);
});

test("stable worker leaves development navigation to the network or dev worker", async () => {
  const runtime = worker();
  await runtime.install();
  assert.equal(await runtime.request("dev/", "navigate"), undefined);
  assert.equal(await runtime.request("dev", "navigate"), undefined);
  assert.equal(await runtime.request("dev?test=1", "navigate"), undefined);
  assert.equal(await runtime.request("dev/src/app.js?v=12"), undefined);
  assert.match(await (await runtime.request("development", "navigate")).text(), /index\.html/);
});

test("dev offline shell and cache cleanup never touch stable caches", async () => {
  const runtime = worker({ root: `${base}dev/`, cacheKeys: ["opwebview-shell-v1", "opwebview-shell-v21", "opwebview-dev-shell-v1", "opwebview-dev-shell-v21"] });
  await runtime.install();
  await runtime.activate();
  assert.deepEqual(runtime.deleted, ["opwebview-dev-shell-v1"]);
  assert.ok(runtime.opened.every((name) => name === "opwebview-dev-shell-v22"));
  assert.match(await (await runtime.request("", "navigate")).text(), /\/dev\/index\.html/);
});

test("a failed update install cannot force activation", async () => {
  const runtime = worker({ failInstall: true });
  await assert.rejects(runtime.install(), /No internet/);
  assert.equal(runtime.skipped, false);
});

test("a missing module offline gets an error response, never cached HTML", async () => {
  const runtime = worker();
  await runtime.install();
  const response = await runtime.request("src/missing.js");
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /index\.html/);
});

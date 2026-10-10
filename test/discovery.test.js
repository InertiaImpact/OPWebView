import test from "node:test";
import assert from "node:assert/strict";
import { privateSubnetPrefix, subnetHosts } from "../public/src/core/device-discovery.js";

test("derives scan prefixes only from private IPv4 addresses", () => {
  assert.equal(privateSubnetPrefix("192.168.143.233"), "192.168.143");
  assert.equal(privateSubnetPrefix("10.42.0.8"), "10.42.0");
  assert.equal(privateSubnetPrefix("172.20.4.2"), "172.20.4");
  assert.equal(privateSubnetPrefix("8.8.8.8"), null);
  assert.equal(privateSubnetPrefix("comma.local"), null);
});

test("subnet scans exclude network and broadcast addresses", () => {
  const hosts = subnetHosts("192.168.143");
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "192.168.143.1");
  assert.equal(hosts.at(-1), "192.168.143.254");
});

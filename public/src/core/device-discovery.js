import { storageKey } from "./app-channel.js";
import { browserStorage, readStored, writeStored } from "./storage.js";
const STORAGE_KEY = storageKey("opwebview.devices.v1");
const DEFAULT_CANDIDATES = ["comma.local"];
const SUBNET_SCAN_CONCURRENCY = 28;

export function normalizeHost(input) {
  const value = String(input ?? "").trim();
  if (!value) throw new Error("Enter a hostname or local IP address.");
  let url;
  try {
    url = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    throw new Error("That hostname or IP address is not valid.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error("Use a local hostname or IP address.");
  }
  const defaultPort = url.protocol === "https:" ? "443" : "5001";
  const port = url.port || defaultPort;
  return {
    host: url.hostname,
    port,
    protocol: url.protocol.slice(0, -1),
    authority: `${url.hostname}${port === defaultPort && url.protocol === "https:" ? "" : `:${port}`}`,
    label: url.hostname
  };
}

export function deviceBaseUrl(device) {
  return `${device.protocol}://${device.authority}`;
}

export class DeviceDiscovery extends EventTarget {
  constructor(storage = browserStorage()) {
    super();
    this.storage = storage;
  }

  saved() {
    return readStored(this.storage, STORAGE_KEY, [], normalizeSavedDevices);
  }

  remember(input, displayName) {
    const device = typeof input === "string" ? normalizeHost(input) : input;
    const next = [
      { ...device, displayName: displayName || device.label, lastConnected: Date.now() },
      ...this.saved().filter((item) => item.authority !== device.authority)
    ].slice(0, 8);
    writeStored(this.storage, STORAGE_KEY, next);
    this.dispatchEvent(new CustomEvent("devices", { detail: next }));
    return next[0];
  }

  forget(authority) {
    const next = this.saved().filter((device) => device.authority !== authority);
    writeStored(this.storage, STORAGE_KEY, next);
    this.dispatchEvent(new CustomEvent("devices", { detail: next }));
  }

  async scan({ signal, onReachable = () => {}, initialTimeoutMs = 2400 } = {}) {
    const startedAt = performance.now();
    const results = new Map();
    const report = { currentSubnets: [], hiddenLocalAddresses: false, checked: 0,
      failures: { timeout: 0, network: 0, http: 0, schema: 0 }, found: 0 };
    this.lastScan = report;
    const probe = (device, timeout) => {
      report.checked++;
      return this.probe(device, timeout, signal, (reason, detail) => {
        if (!Object.hasOwn(report.failures, reason)) return;
        report.failures[reason]++;
        if (!report.example && ["http", "schema"].includes(reason)) report.example = { address: device.authority, reason, ...detail };
      });
    };
    const found = (device) => {
      if (signal?.aborted || results.has(device.authority)) return;
      const result = { ...device, reachable: true };
      results.set(device.authority, result);
      report.found++;
      // Publish before invoking auto-connect, which may immediately abort scanning.
      this.dispatchEvent(new CustomEvent("devicefound", { detail: result }));
      onReachable(result);
    };
    this.dispatchEvent(new CustomEvent("scanstart"));
    this.dispatchEvent(new CustomEvent("scanprogress", { detail: "Checking the current network…" }));
    // Hostname resolution and current-interface discovery run together. Nothing
    // from saved drives is probed, displayed, or used to guess today's subnet.
    const hostnameScan = Promise.all(DEFAULT_CANDIDATES.map(async (host) => {
      const device = normalizeHost(host);
      if (await probe(device, initialTimeoutMs)) found(device);
    }));
    try {
      const local = await this.localSubnets(signal);
      report.currentSubnets = local.prefixes.slice(0, 3);
      report.hiddenLocalAddresses = local.hiddenLocalAddresses;
      for (const prefix of report.currentSubnets) {
        if (signal?.aborted) break;
        this.dispatchEvent(new CustomEvent("scanprogress", { detail: `Scanning ${prefix}.x…` }));
        await this.scanSubnet(prefix, signal, found, probe);
      }
      await hostnameScan;
    } finally {
      report.cancelled = Boolean(signal?.aborted && !report.found);
      report.elapsedMs = Math.round(performance.now() - startedAt);
      this.dispatchEvent(new CustomEvent("scanreport", { detail: report }));
    }
    const devices = [...results.values()];
    this.dispatchEvent(new CustomEvent("scancomplete", { detail: devices }));
    return devices;
  }

  localSubnets(signal) { return discoverLocalSubnetPrefixes(signal); }

  async probe(device, timeoutMs = 2400, signal, report = () => {}) {
    if (signal?.aborted) return false;
    try {
      const options = {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
      };
      options.targetAddressSpace = "local";
      const response = await fetch(`${deviceBaseUrl(device)}/schema?services=deviceState`, options);
      // Only auto-connect to a positively identified comma service, never a
      // random HTTP server or opaque no-CORS response discovered on port 5001.
      if (!response.ok) { report("http", { status: response.status }); return false; }
      const schema = await response.json();
      const valid = Boolean(schema?.deviceState && typeof schema.deviceState === "object" && !Array.isArray(schema.deviceState));
      if (!valid) report("schema", { message: "Response is not a deviceState schema" });
      return valid;
    } catch (error) {
      if (!signal?.aborted) report(error.name === "TimeoutError" ? "timeout" : error instanceof SyntaxError ? "schema" : "network");
      return false;
    }
  }

  async scanSubnet(prefix, signal, onReachable = () => {}, probe = (device, timeout) => this.probe(device, timeout, signal)) {
    const queue = subnetHosts(prefix).map((host) => normalizeHost(host));
    let cursor = 0;
    const worker = async () => {
      while (!signal?.aborted && cursor < queue.length) {
        const device = queue[cursor++];
        if (await probe(device, 1300) && !signal?.aborted) {
          onReachable({ ...device, displayName: `comma (${device.host})` });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SUBNET_SCAN_CONCURRENCY, queue.length) }, worker));
  }
}

export function normalizeSavedDevices(items) {
  if (!Array.isArray(items)) return null;
  const result = [];
  const seen = new Set();
  for (const item of items) {
    try {
      let input;
      if (typeof item === "string") input = item;
      else if (item && typeof item === "object" && !Array.isArray(item)) {
        const protocol = item.protocol ?? "http";
        if (!["http", "https"].includes(protocol)) continue;
        const address = item.authority || (typeof item.host === "string" &&
          `${item.host}${item.port ? `:${item.port}` : ""}`);
        if (typeof address !== "string" || !address || address.includes("://")) continue;
        input = `${protocol}://${address}`;
      } else continue;
      const device = normalizeHost(input);
      if (seen.has(device.authority)) continue;
      seen.add(device.authority);
      const label = typeof item.label === "string" ? item.label.slice(0, 100) : device.label;
      const displayName = typeof item.displayName === "string" ? item.displayName.slice(0, 100) : label;
      const lastConnected = Number(item.lastConnected);
      result.push({ ...device, label, displayName,
        lastConnected: Number.isFinite(lastConnected) && lastConnected > 0 ? Math.min(lastConnected, Date.now()) : 0 });
      if (result.length === 8) break;
    } catch { /* Drop only this malformed device, keeping other saved devices. */ }
  }
  return result;
}

export function privateSubnetPrefix(host) {
  const octets = String(host || "").split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  const [a, b, c] = octets;
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  return isPrivate ? `${a}.${b}.${c}` : null;
}

export function subnetHosts(prefix) {
  return Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`);
}

export async function discoverLocalSubnetPrefixes(signal) {
  if (typeof RTCPeerConnection === "undefined") return { prefixes: [], hiddenLocalAddresses: true };
  const prefixes = new Set();
  let peer, hiddenLocalAddresses = false;
  const addAddress = (address) => {
    const prefix = privateSubnetPrefix(address);
    if (prefix) prefixes.add(prefix);
    else if (String(address || "").endsWith(".local")) hiddenLocalAddresses = true;
  };
  try {
    if (signal?.aborted) return { prefixes: [], hiddenLocalAddresses: false };
    peer = new RTCPeerConnection({ iceServers: [] });
    peer.createDataChannel("discovery");
    peer.addEventListener("icecandidate", (event) => {
      addAddress(event.candidate?.address || event.candidate?.candidate?.split(/\s+/)[4]);
    });
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", change); signal?.removeEventListener("abort", done); resolve(); };
      const change = () => { if (peer.iceGatheringState === "complete") done(); };
      const timer = setTimeout(done, 1200);
      peer.addEventListener("icegatheringstatechange", change);
      signal?.addEventListener("abort", done, { once: true });
      if (signal?.aborted || peer.iceGatheringState === "complete") done();
    });
    if (signal?.aborted) return { prefixes: [], hiddenLocalAddresses };
    for (const match of (peer.localDescription?.sdp || "").matchAll(/candidate:[^\r\n]+?\s(\S+)\s\d+\styp\shost/g)) addAddress(match[1]);
    if (peer.getStats) {
      const stats = await peer.getStats();
      stats.forEach((candidate) => {
        if (candidate.type === "local-candidate" && candidate.candidateType === "host") addAddress(candidate.address || candidate.ip);
      });
    }
  } catch {
    // Permission to fetch LAN devices does not grant access to interface IPs.
  } finally {
    peer?.close();
  }
  return { prefixes: [...prefixes], hiddenLocalAddresses: hiddenLocalAddresses || prefixes.size === 0 };
}

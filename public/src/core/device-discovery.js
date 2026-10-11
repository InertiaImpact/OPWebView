import { storageKey } from "./app-channel.js";
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
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
  }

  saved() {
    try {
      const items = JSON.parse(this.storage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(items) ? items.filter((item) => item?.host && item?.authority) : [];
    } catch {
      return [];
    }
  }

  remember(input, displayName) {
    const device = typeof input === "string" ? normalizeHost(input) : input;
    const next = [
      { ...device, displayName: displayName || device.label, lastConnected: Date.now() },
      ...this.saved().filter((item) => item.authority !== device.authority)
    ].slice(0, 8);
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.dispatchEvent(new CustomEvent("devices", { detail: next }));
    return next[0];
  }

  forget(authority) {
    const next = this.saved().filter((device) => device.authority !== authority);
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.dispatchEvent(new CustomEvent("devices", { detail: next }));
  }

  async scan() {
    const candidates = new Map();
    for (const device of this.saved()) candidates.set(device.authority, device);
    for (const host of DEFAULT_CANDIDATES) {
      const device = normalizeHost(host);
      if (!candidates.has(device.authority)) candidates.set(device.authority, device);
    }

    this.dispatchEvent(new CustomEvent("scanstart"));
    this.dispatchEvent(new CustomEvent("scanprogress", { detail: "Checking saved addresses…" }));
    const results = await Promise.all([...candidates.values()].map(async (device) => ({
      ...device,
      reachable: await this.probe(device)
    })));

    if (!results.some((device) => device.reachable)) {
      const prefixes = new Set(this.saved().map((device) => privateSubnetPrefix(device.host)).filter(Boolean));
      for (const prefix of await discoverLocalSubnetPrefixes()) prefixes.add(prefix);
      for (const prefix of [...prefixes].slice(0, 3)) {
        this.dispatchEvent(new CustomEvent("scanprogress", { detail: `Scanning ${prefix}.x…` }));
        const found = await this.scanSubnet(prefix, candidates);
        if (found) {
          results.push({ ...found, reachable: true });
          break;
        }
      }
    }

    results.sort((a, b) => Number(b.reachable) - Number(a.reachable) || (b.lastConnected || 0) - (a.lastConnected || 0));
    this.dispatchEvent(new CustomEvent("scancomplete", { detail: results }));
    return results;
  }

  async probe(device, timeoutMs = 2400) {
    try {
      const options = {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs)
      };
      options.targetAddressSpace = "local";
      await fetch(`${deviceBaseUrl(device)}/schema?services=deviceState`, options);
      return true;
    } catch {
      return false;
    }
  }

  async scanSubnet(prefix, existing) {
    const queue = subnetHosts(prefix)
      .map((host) => normalizeHost(host))
      .filter((device) => !existing.has(device.authority));
    let cursor = 0;
    let found = null;

    const worker = async () => {
      while (!found && cursor < queue.length) {
        const device = queue[cursor++];
        if (await this.probe(device, 1300)) {
          found = { ...device, displayName: `comma (${device.host})` };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SUBNET_SCAN_CONCURRENCY, queue.length) }, worker));
    return found;
  }
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

async function discoverLocalSubnetPrefixes() {
  if (typeof RTCPeerConnection === "undefined") return [];
  const prefixes = new Set();
  const peer = new RTCPeerConnection({ iceServers: [] });
  try {
    peer.createDataChannel("discovery");
    peer.addEventListener("icecandidate", (event) => {
      const address = event.candidate?.candidate?.split(/\s+/)[4];
      const prefix = privateSubnetPrefix(address);
      if (prefix) prefixes.add(prefix);
    });
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1200);
      peer.addEventListener("icegatheringstatechange", () => {
        if (peer.iceGatheringState === "complete") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    for (const match of (peer.localDescription?.sdp || "").matchAll(/candidate:[^\r\n]+\s(\d+\.\d+\.\d+\.\d+)\s\d+\styp\shost/g)) {
      const prefix = privateSubnetPrefix(match[1]);
      if (prefix) prefixes.add(prefix);
    }
  } catch {
    // Modern browsers can hide host candidates; saved IPs still provide a subnet.
  } finally {
    peer.close();
  }
  return [...prefixes];
}

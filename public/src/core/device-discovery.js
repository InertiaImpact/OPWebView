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
    const saved = this.saved();
    const candidates = new Map();
    for (const device of saved) candidates.set(device.authority, device);
    for (const host of DEFAULT_CANDIDATES) {
      const device = normalizeHost(host);
      if (!candidates.has(device.authority)) candidates.set(device.authority, device);
    }

    this.dispatchEvent(new CustomEvent("scanstart"));
    this.dispatchEvent(new CustomEvent("scanprogress", { detail: "Checking saved addresses…" }));
    const results = await Promise.all([...candidates.values()].map(async (device) => {
      const result = { ...device, reachable: await this.probe(device, initialTimeoutMs, signal) };
      if (result.reachable && !signal?.aborted) {
        this.dispatchEvent(new CustomEvent("devicefound", { detail: result }));
        onReachable(result);
      }
      return result;
    }));

    if (!signal?.aborted && !results.some((device) => device.reachable)) {
      // Current interfaces take priority over historical networks. Keep saved
      // devices intact when DHCP or Wi-Fi changes; never require clearing data.
      const prefixes = new Set(await discoverLocalSubnetPrefixes());
      for (const device of saved) {
        const prefix = privateSubnetPrefix(device.host);
        if (prefix) prefixes.add(prefix);
      }
      for (const prefix of [...prefixes].slice(0, 3)) {
        if (signal?.aborted) break;
        this.dispatchEvent(new CustomEvent("scanprogress", { detail: `Scanning ${prefix}.x…` }));
        const found = await this.scanSubnet(prefix, candidates, signal);
        if (found) {
          results.push({ ...found, reachable: true });
          this.dispatchEvent(new CustomEvent("devicefound", { detail: { ...found, reachable: true } }));
          onReachable({ ...found, reachable: true });
          break;
        }
      }
    }

    results.sort((a, b) => Number(b.reachable) - Number(a.reachable) || (b.lastConnected || 0) - (a.lastConnected || 0));
    this.dispatchEvent(new CustomEvent("scancomplete", { detail: results }));
    return results;
  }

  async probe(device, timeoutMs = 2400, signal) {
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
      if (!response.ok) return false;
      const schema = await response.json();
      return Boolean(schema?.deviceState && typeof schema.deviceState === "object");
    } catch {
      return false;
    }
  }

  async scanSubnet(prefix, existing, signal) {
    const queue = subnetHosts(prefix)
      .map((host) => normalizeHost(host))
      // An initial timeout is not proof that a saved device stays unavailable.
      // Retry saved IPs first, once, then search the rest of the bounded subnet.
      .sort((a, b) => Number(existing.has(b.authority)) - Number(existing.has(a.authority)));
    let cursor = 0;
    let found = null;

    const worker = async () => {
      while (!found && !signal?.aborted && cursor < queue.length) {
        const device = queue[cursor++];
        if (await this.probe(device, 1300, signal) && !found && !signal?.aborted) {
          const saved = existing.get(device.authority);
          found = { ...device, ...saved, displayName: saved?.displayName || `comma (${device.host})` };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SUBNET_SCAN_CONCURRENCY, queue.length) }, worker));
    return found;
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

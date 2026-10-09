const STORAGE_KEY = "opwebview.devices.v1";
const DEFAULT_CANDIDATES = ["comma.local"];

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
    const results = await Promise.all([...candidates.values()].map(async (device) => ({
      ...device,
      reachable: await this.probe(device)
    })));
    results.sort((a, b) => Number(b.reachable) - Number(a.reachable) || (b.lastConnected || 0) - (a.lastConnected || 0));
    this.dispatchEvent(new CustomEvent("scancomplete", { detail: results }));
    return results;
  }

  async probe(device) {
    try {
      const options = {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: AbortSignal.timeout(2400)
      };
      options.targetAddressSpace = "local";
      await fetch(`${deviceBaseUrl(device)}/schema?services=deviceState`, options);
      return true;
    } catch {
      return false;
    }
  }
}

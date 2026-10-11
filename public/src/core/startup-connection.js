export async function localNetworkPermission(permissions = globalThis.navigator?.permissions) {
  for (const name of ["local-network", "local-network-access"]) {
    try { return await permissions.query({ name }); } catch {}
  }
  return null;
}

export class StartupConnection {
  constructor({ discovery, permission, connect, idle, status = () => {},
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = (id) => clearTimeout(id) }) {
    Object.assign(this, { discovery, permission, connect, idle, status, setTimer, clearTimer });
    this.generation = 0;
  }

  cancel() {
    this.generation++;
    this.controller?.abort();
    this.clearTimer(this.timer);
    this.timer = null;
    this.running = false;
    this.status("idle");
  }

  async start() {
    if (this.running || !this.idle()) return;
    this.cancel();
    const generation = this.generation;
    this.running = true;
    this.controller = new AbortController();
    const current = () => generation === this.generation && this.running && this.idle();
    try {
      const permission = await this.permission();
      if (!current()) return;
      if (permission === "denied") {
        this.running = false;
        this.status("permission", "Local-network access is blocked. Allow it in this site's browser settings, then tap Scan network.");
        return;
      }
      // A local fetch is the permission request: there is no web Permissions
      // API request() method. Denied grants must be changed by the user.
      this.status("scanning", "Scanning for your comma… Allow local-network access if prompted.");
      let chosen = null;
      const connect = async (device) => {
        if (!current()) return;
        this.clearTimer(this.timer); this.timer = null;
        this.running = false;
        this.controller.abort();
        this.status("connecting", `Connecting to ${device.label || device.host}…`);
        try {
          const success = await this.connect(device);
          if (generation === this.generation) this.status(success === false ? "not-found" : "idle",
            success === false ? "Automatic connection failed. Use Connect or Scan network to retry." : "");
        } catch (error) {
          if (generation === this.generation) this.status("not-found", `Connection failed: ${error.message}`);
        }
      };
      const results = await this.discovery.scan({ signal: this.controller.signal,
        // Give the user time to answer a first-load browser permission prompt.
        initialTimeoutMs: permission === "prompt" ? 30000 : 2400, onReachable: (device) => {
        if (!current()) return;
        if (device.lastConnected) { void connect(device); return; }
        if (chosen) return;
        chosen = device;
        this.status("waiting", `Found ${device.label || device.host}. Connecting in 5 seconds…`);
        this.timer = this.setTimer(async () => {
          this.timer = null;
          if (!current()) return;
          if (await this.discovery.probe(chosen, 1300, this.controller.signal)) await connect(chosen);
          else if (current()) { this.running = false; this.status("not-found", "The discovered comma is no longer available. Tap Scan network to retry."); }
        }, 5000);
      }});
      if (!current()) return;
      if (!chosen && !results.some((device) => device.reachable)) {
        this.running = false;
        const state = await this.permission();
        if (generation !== this.generation) return;
        this.status(state === "denied" || state === "prompt" ? "permission" : "not-found",
          state === "denied" ? "Local-network access is blocked. Allow it in this site's browser settings."
            : "No comma found. Tap Scan network to retry, or + to enter an IP address.");
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.running = false;
      this.status("not-found", `Automatic discovery could not finish: ${error.message}`);
    }
  }
}

export async function localNetworkPermission(permissions = globalThis.navigator?.permissions) {
  for (const name of ["local-network", "local-network-access"]) {
    try { return await permissions.query({ name }); } catch {}
  }
  return null;
}

export class StartupConnection {
  constructor({ discovery, permission, connect, idle, status = () => {} }) {
    Object.assign(this, { discovery, permission, connect, idle, status });
    this.generation = 0;
  }

  cancel() {
    this.generation++;
    this.controller?.abort();
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
        this.status("permission", "Network access blocked. Allow it in Chrome settings, then scan.");
        return;
      }
      // A local fetch is the permission request: there is no web Permissions
      // API request() method. Denied grants must be changed by the user.
      this.status("scanning", "Finding comma… Allow network access if asked.");
      const connect = async (device) => {
        if (!current()) return;
        this.running = false;
        this.controller.abort();
        this.status("connecting", `Connecting to ${device.label || device.host}…`);
        try {
          const success = await this.connect(device);
          if (generation === this.generation) this.status(success === false ? "not-found" : "idle",
            success === false ? "Couldn't connect. Tap Scan to retry." : "");
        } catch (error) {
          if (generation === this.generation) this.status("not-found", `Connection failed: ${error.message}`);
        }
      };
      const results = await this.discovery.scan({ signal: this.controller.signal,
        // Give the user time to answer a first-load browser permission prompt.
        initialTimeoutMs: permission === "prompt" ? 30000 : 2400, onReachable: (device) => {
        if (!current()) return;
        void connect(device);
      }});
      if (!current()) return;
      if (!results.some((device) => device.reachable)) {
        this.running = false;
        const state = await this.permission();
        if (generation !== this.generation) return;
        this.status(state === "denied" || state === "prompt" ? "permission" : "not-found",
          state === "denied" ? "Network access blocked. Allow it in Chrome settings."
            : this.discovery.lastScan?.hiddenLocalAddresses && !this.discovery.lastScan?.currentSubnets.length
              ? "Wi-Fi subnet hidden. Use + to enter the comma IP."
              : "No comma found. Tap Scan, or + to add its IP.");
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.running = false;
      this.status("not-found", `Automatic discovery could not finish: ${error.message}`);
    }
  }
}

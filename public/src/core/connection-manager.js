const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;
const WIDE_CAMERA_MAX_SPEED = 10;
const ROAD_CAMERA_MIN_SPEED = 15;

export class ConnectionManager extends EventTarget {
  constructor({ store, transport, adapter, discovery }) {
    super();
    this.store = store;
    this.transport = transport;
    this.adapter = adapter;
    this.discovery = discovery;
    this.device = null;
    this.streamType = "road";
    this.retryCount = 0;
    this.retryTimer = null;
    this.connecting = false;
    this.userClosed = false;
    this.wakeLock = null;

    transport.addEventListener("data", (event) => {
      adapter.apply(event.detail);
      this.switchCameraIfNeeded();
    });
    transport.addEventListener("state", (event) => {
      if (event.detail === "failed" && !this.userClosed) this.scheduleReconnect();
      this.dispatchEvent(new CustomEvent("state", { detail: event.detail }));
    });
    transport.addEventListener("video", () => this.dispatchEvent(new CustomEvent("video")));
  }

  async connect(input, { remember = true } = {}) {
    if (this.connecting) return;
    this.device = typeof input === "string" ? this.discovery.remember(input) : input;
    if (remember) this.device = this.discovery.remember(this.device);
    this.userClosed = false;
    this.connecting = true;
    clearTimeout(this.retryTimer);
    this.adapter.reset();
    this.store.update((state) => {
      state.streamType = this.streamType;
      state.isSwitchingStream = false;
    });
    this.dispatchEvent(new CustomEvent("state", { detail: "connecting" }));
    try {
      await this.transport.connect(this.device, { camera: this.streamType });
      this.retryCount = 0;
      this.store.setConnection(true);
      this.dispatchEvent(new CustomEvent("connected", { detail: this.device }));
      await this.acquireWakeLock();
    } catch (error) {
      this.store.setConnection(false);
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
      if (!this.userClosed) this.scheduleReconnect();
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    this.userClosed = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryCount = 0;
    this.connecting = false;
    this.adapter.reset();
    await this.transport.close();
    await this.releaseWakeLock();
    this.store.setConnection(false);
    this.dispatchEvent(new CustomEvent("state", { detail: "disconnected" }));
  }

  scheduleReconnect() {
    if (this.userClosed || !this.device || this.retryTimer) return;
    this.store.setConnection(false);
    this.retryCount += 1;
    if (this.retryCount > MAX_RETRIES) {
      this.dispatchEvent(new CustomEvent("state", { detail: "offline" }));
      this.retryCount = 0;
      return;
    }
    this.dispatchEvent(new CustomEvent("retry", { detail: this.retryCount }));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(this.device, { remember: false }).catch(() => {});
    }, RETRY_DELAY);
  }

  switchCameraIfNeeded() {
    const state = this.store.state;
    let target = "road";
    if (state.experimentalMode) {
      if (state.vEgo < WIDE_CAMERA_MAX_SPEED) target = "wideRoad";
      else if (state.vEgo <= ROAD_CAMERA_MIN_SPEED) return;
    }
    if (target === this.streamType) return;
    this.streamType = target;
    this.store.update((next) => {
      next.streamType = target;
      next.isSwitchingStream = true;
    });
    this.transport.close().then(() => this.connect(this.device, { remember: false })).then(() => {
      this.store.update((next) => { next.isSwitchingStream = false; });
    }).catch(() => {});
  }

  async acquireWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { this.wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }

  async releaseWakeLock() {
    try { await this.wakeLock?.release(); } catch {}
    this.wakeLock = null;
  }
}

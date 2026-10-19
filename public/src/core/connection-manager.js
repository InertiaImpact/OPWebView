import { normalizeHost } from "./device-discovery.js";
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
    this.retryExhausted = false;
    this.retryTimer = null;
    this.connecting = false;
    this.userClosed = false;
    this.wakeLock = null;
    this.generation = 0;

    transport.addEventListener("data", (event) => {
      if (adapter.apply(event.detail) > 0) transport.markTelemetryReceived?.(adapter.lastAppliedTypes);
      this.switchCameraIfNeeded();
    });
    transport.addEventListener("state", (event) => {
      // A peer that recovers before the retry begins no longer needs replacing.
      if (event.detail === "connected" && !this.userClosed && !this.connecting && this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryCount = 0;
        this.store.setConnection(true);
      }
      // Retry only after a stream was previously healthy, or while continuing
      // an existing recovery sequence. An initial negotiation failure needs to
      // remain visible so the user can act on its specific diagnostic.
      if (event.detail === "failed" && !this.userClosed && !this.retryExhausted &&
          (this.store.state.isConnected || this.retryCount > 0)) {
        this.scheduleReconnect();
      }
      this.dispatchEvent(new CustomEvent("state", { detail: event.detail }));
    });
    transport.addEventListener("video", () => this.dispatchEvent(new CustomEvent("video")));
    transport.addEventListener("progress", (event) => this.dispatchEvent(new CustomEvent("progress", { detail: event.detail })));
    transport.addEventListener("health", (event) => this.dispatchEvent(new CustomEvent("health", { detail: event.detail })));
    transport.addEventListener("diagnostic", (event) => this.dispatchEvent(new CustomEvent("diagnostic", { detail: event.detail })));
  }

  async connect(input, { remember = false, camera = this.streamType, retry = false } = {}) {
    if (this.connecting) return;
    if (!retry) {
      this.retryCount = 0;
      this.retryExhausted = false;
    }
    const generation = ++this.generation;
    this.device = typeof input === "string" ? normalizeHost(input) : input;
    this.userClosed = false;
    this.connecting = true;
    const switching = camera !== this.streamType;
    if (switching) this.dispatchEvent(new CustomEvent("handoff"));
    this.streamType = camera;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.adapter.reset();
    this.store.update((state) => {
      state.streamType = this.streamType;
      state.isSwitchingStream = switching;
    });
    this.dispatchEvent(new CustomEvent("state", { detail: "connecting" }));
    try {
      await this.transport.connect(this.device, { camera: this.streamType });
      if (generation !== this.generation || this.userClosed) throw new Error("The connection attempt was cancelled.");
      if (remember) this.device = this.discovery.remember(this.device);
      this.retryCount = 0;
      this.retryExhausted = false;
      this.store.setConnection(true);
      this.dispatchEvent(new CustomEvent("connected", { detail: this.device }));
      await this.acquireWakeLock();
      if (generation !== this.generation || this.userClosed) throw new Error("The connection attempt was cancelled.");
    } catch (error) {
      if (generation !== this.generation) throw error;
      this.store.setConnection(false);
      if (!this.userClosed && !this.retryExhausted && (error.retryable || this.retryCount > 0)) this.scheduleReconnect();
      // Observers need the final retry/exhaustion decision, including failures
      // from background retries that do not pass through the original UI call.
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
      throw error;
    } finally {
      if (generation === this.generation) {
        this.connecting = false;
        this.store.update((state) => { state.isSwitchingStream = false; });
        this.switchCameraIfNeeded();
      }
    }
  }

  async disconnect() {
    this.generation++;
    this.userClosed = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryCount = 0;
    this.retryExhausted = false;
    this.connecting = false;
    this.adapter.reset();
    await this.transport.close();
    await this.releaseWakeLock();
    this.store.setConnection(false);
    this.store.update((state) => { state.isSwitchingStream = false; });
    this.dispatchEvent(new CustomEvent("state", { detail: "disconnected" }));
  }

  scheduleReconnect() {
    if (this.userClosed || this.retryExhausted || !this.device || this.retryTimer) return;
    this.store.setConnection(false);
    this.retryCount += 1;
    if (this.retryCount > MAX_RETRIES) {
      this.retryCount = 0;
      this.retryExhausted = true;
      this.dispatchEvent(new CustomEvent("state", { detail: "offline" }));
      return;
    }
    this.dispatchEvent(new CustomEvent("retry", { detail: this.retryCount }));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(this.device, { remember: false, retry: true }).catch(() => {});
    }, RETRY_DELAY);
  }

  switchCameraIfNeeded() {
    // Telemetry arrives before video readiness. Never close an opening session,
    // and never start two camera handoffs at once. Re-evaluate the latest mode
    // and speed when the active negotiation finishes (same 10/15 m/s hysteresis).
    if (this.connecting || this.userClosed || !this.device || !this.store.state.isConnected || globalThis.document?.hidden) return;
    const state = this.store.state;
    let target = "road";
    if (state.experimentalMode) {
      if (state.vEgo < WIDE_CAMERA_MAX_SPEED) target = "wideRoad";
      else if (state.vEgo <= ROAD_CAMERA_MIN_SPEED) return;
    }
    if (target === this.streamType) return;
    this.dispatchEvent(new CustomEvent("progress", { detail: `Switching camera: ${this.streamType} → ${target}` }));
    if (typeof this.transport.switchCamera === "function") {
      this.switchLiveCamera(target);
      return;
    }
    // Transport.connect owns closing/replacing its previous peer; there is no
    // separate close/reconnect gap where another telemetry packet can intervene.
    this.connect(this.device, { remember: false, camera: target }).catch(() => {});
  }

  async switchLiveCamera(target) {
    const generation = this.generation, from = this.streamType;
    this.connecting = true; // Serialize mode changes without changing link/UI state.
    this.store.update((state) => { state.isSwitchingStream = true; });
    try {
      await this.transport.switchCamera(target);
      if (generation !== this.generation || this.userClosed) return;
      this.streamType = target;
      this.store.update((state) => { state.streamType = target; });
      this.dispatchEvent(new CustomEvent("diagnostic", { detail: {
        kind: "camera-switch", method: "in-session", from, to: target,
        peer: this.transport.peer?.connectionState, sourceAcknowledged: false
      } }));
    } catch (error) {
      if (generation !== this.generation || this.userClosed || error.cancelled || this.retryTimer) return;
      this.dispatchEvent(new CustomEvent("diagnostic", { detail: {
        kind: "camera-switch-fallback", from, to: target, error: error.message
      } }));
      // A stalled video or older browser uses the existing bounded recovery,
      // with a video-only snapshot and continuous overlay instead of a blank.
      this.connecting = false;
      await this.connect(this.device, { camera: target }).catch(() => {});
    } finally {
      if (generation === this.generation) {
        this.connecting = false;
        this.store.update((state) => { state.isSwitchingStream = false; });
        this.switchCameraIfNeeded();
      }
    }
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

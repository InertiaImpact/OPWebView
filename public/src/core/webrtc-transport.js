import { deviceBaseUrl } from "./device-discovery.js";

const BASE_BRIDGE_SERVICES_OUT = Object.freeze([
  "carState",
  "selfdriveState",
  "controlsState",
  "modelV2",
  "radarState",
  "longitudinalPlan",
  "deviceState"
]);

export const OPTIONAL_BRIDGE_SERVICES_OUT = Object.freeze([
  "longitudinalPlanSP",
  "liveMapDataSP",
  "carControl",
  "carOutput",
  "selfdriveStateSP",
  "onroadEvents",
  "driverMonitoringState",
  "chestnutState"
]);

// openpilot renamed these services after the native opview client was released.
// Probe the device before creating a SubMaster because requesting even one
// unknown service makes the entire WebRTC stream request fail.
export const SERVICE_PROFILES = Object.freeze([
  Object.freeze({ calibration: "extrinsicsCalibration", camera: "narrowRoadCameraState" }),
  Object.freeze({ calibration: "liveCalibration", camera: "roadCameraState" })
]);
export const TELEMETRY_STALE_MS = 5000;
export const DISCONNECT_GRACE_MS = 5000;
const LIVE_SERVICES = ["carState", "modelV2"];

export class WebRTCTransport extends EventTarget {
  constructor(videoElement) {
    super();
    this.videoElement = videoElement;
    this.peer = null;
    this.channel = null;
    this.generation = 0;
    this.readiness = createReadinessState();
    this.lastTelemetry = new Map();
    this.staleServices = [];
    this.sessionLive = false;
    this.disconnectTimer = null;
  }

  async connect(device, { camera = "road" } = {}) {
    const generation = ++this.generation;
    await this.close({ invalidate: false });
    if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
    this.readiness = createReadinessState();
    this.dispatchState("connecting");
    this.dispatchProgress("Creating a secure camera and telemetry session…");

    const peer = new RTCPeerConnection({ iceServers: [] });
    this.peer = peer;
    peer.addEventListener("connectionstatechange", () => this.handlePeerState(peer, generation));
    peer.addEventListener("iceconnectionstatechange", () => {
      if (generation === this.generation && peer === this.peer) this.reportLinkState("ice", peer);
    });
    peer.addEventListener("track", (event) => {
      if (generation !== this.generation || event.track.kind !== "video") return;
      this.readiness.videoTrack = true;
      this.dispatchProgress(`Camera track received (${camera}). Waiting for a playable frame…`);
      this.videoElement.srcObject = event.streams[0] || new MediaStream([event.track]);
      const markFrame = () => this.markVideoReady(generation);
      this.waitForPresentedVideo(markFrame);
      event.track.addEventListener("unmute", () => {
        this.videoElement.play().catch((error) => this.dispatchProgress(`Camera playback was blocked: ${error.message}`));
      }, { once: true });
      this.videoElement.play().catch((error) => this.dispatchProgress(`Camera playback was blocked: ${error.message}`));
    });
    peer.addEventListener("datachannel", (event) => {
      if (generation === this.generation) this.attachChannel(event.channel, generation);
    });

    // Match gerrylum/opview: telemetry is time-sensitive, so stale packets are
    // dropped instead of holding up every later update on an unreliable link.
    this.attachChannel(peer.createDataChannel("data", { ordered: false, maxRetransmits: 0 }), generation);
    peer.addTransceiver("video", { direction: "recvonly" });
    try {
      const offer = await peer.createOffer();
      offer.sdp = preferH264(offer.sdp || "");
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, 5000);
      if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");

      this.dispatchProgress(`Requesting the ${camera === "wideRoad" ? "wide-road" : "road"} camera and openpilot data…`);
      const services = await resolveBridgeServices(device);
      const response = await postStreamWithFallback(device, peer.localDescription?.sdp || offer.sdp, camera, services);
      if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
      await peer.setRemoteDescription(new RTCSessionDescription(response));
      await waitForPeerConnection(peer, 15000);
      if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
      this.startupDiagnosticTimer = setTimeout(() => this.reportStartupReadiness(generation, camera), 5000);
      await this.waitForStreams(generation, 20000);
      if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
      clearTimeout(this.startupDiagnosticTimer);
      if (generation === this.generation) {
        this.sessionLive = true;
        this.startTelemetryHealth();
        this.dispatchState("connected");
        this.dispatchProgress("Camera and telemetry are live.");
      }
    } catch (error) {
      if (generation === this.generation) {
        this.dispatchState("failed");
        await this.close({ invalidate: false });
      }
      throw error;
    }
  }

  handlePeerState(peer, generation) {
    if (generation !== this.generation || peer !== this.peer) return;
    const state = peer.connectionState;
    this.reportLinkState("peer", peer);
    this.readiness.peerConnected = state === "connected";
    if (state === "connected") {
      const recovered = this.disconnectTimer !== null;
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      this.dispatchState(this.sessionLive ? "connected" : "waiting");
      if (this.sessionLive) {
        this.checkTelemetryHealth();
        if (recovered) this.dispatchProgress("Secure link recovered without restarting streams.");
      } else this.dispatchProgress("Secure link established. Waiting for camera and telemetry…");
    } else if (state === "disconnected" && this.sessionLive) {
      // A temporary ICE interruption can recover without replacing the peer.
      // Startup and terminal failures retain their existing bounded deadlines.
      if (this.disconnectTimer !== null) return;
      this.dispatchState("interrupted");
      this.dispatchProgress("Link interrupted; allowing up to five seconds for recovery…");
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        if (generation !== this.generation || peer !== this.peer || peer.connectionState === "connected") return;
        this.reportLinkState("recovery-timeout", peer);
        this.dispatchState("failed");
      }, DISCONNECT_GRACE_MS);
    } else if (["failed", "disconnected", "closed"].includes(state)) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      this.dispatchState("failed");
    } else this.dispatchState(this.disconnectTimer !== null ? "interrupted" : "connecting");
  }

  reportLinkState(kind, peer = this.peer, error) {
    this.dispatchEvent(new CustomEvent("diagnostic", { detail: {
      kind, peer: peer?.connectionState, ice: peer?.iceConnectionState,
      channel: this.channel?.readyState, online: globalThis.navigator?.onLine,
      hidden: globalThis.document?.hidden,
      ...(error ? { error: String(error.message || error).slice(0, 120) } : {})
    } }));
  }

  attachChannel(channel, generation) {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    const onOpen = () => {
      if (generation !== this.generation) return;
      this.readiness.dataChannelOpen = true;
      this.dispatchProgress("Telemetry channel open. Waiting for camera frames and data…");
      // rx-wb responds to clockSync even when the car is offroad, giving us an
      // immediate end-to-end check that the server's message loop is running.
      channel.send(JSON.stringify({
        type: "clockSync",
        data: { action: "ping", browserSendTime: Date.now() }
      }));
    };
    channel.addEventListener("open", onOpen, { once: true });
    channel.addEventListener("error", (event) => {
      if (generation !== this.generation) return;
      this.reportLinkState("channel-error", this.peer, event.error);
      this.dispatchProgress("The telemetry channel reported an error.");
    });
    channel.addEventListener("close", () => {
      if (generation === this.generation && this.peer) this.reportLinkState("channel-close");
    });
    channel.addEventListener("message", async (event) => {
      if (generation !== this.generation) return;
      let text;
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof Blob) text = await event.data.text();
      else text = new TextDecoder().decode(event.data);
      if (generation !== this.generation) return;
      this.dispatchEvent(new CustomEvent("data", { detail: text }));
    });
    if (channel.readyState === "open") onOpen();
  }

  markVideoReady(generation) {
    if (generation !== this.generation || this.readiness.videoReady) return;
    this.cancelVideoReady?.();
    this.readiness.videoReady = true;
    this.dispatchEvent(new CustomEvent("video"));
    this.dispatchProgress("Camera is live. Waiting for telemetry data…");
  }

  waitForPresentedVideo(markFrame) {
    this.cancelVideoReady?.();
    const video = this.videoElement;
    if (typeof video.requestVideoFrameCallback === "function") {
      const id = video.requestVideoFrameCallback(markFrame);
      this.cancelVideoReady = () => { video.cancelVideoFrameCallback?.(id); this.cancelVideoReady = null; };
    } else {
      // Older browsers lack presentation callbacks; a playable frame remains
      // their best available readiness signal. Remove both listeners together.
      const ready = () => { if (video.readyState >= 2) markFrame(); };
      video.addEventListener("playing", ready);
      video.addEventListener("loadeddata", ready);
      this.cancelVideoReady = () => {
        video.removeEventListener("playing", ready);
        video.removeEventListener("loadeddata", ready);
        this.cancelVideoReady = null;
      };
    }
  }

  async reportStartupReadiness(generation, camera) {
    const peer = this.peer;
    if (generation !== this.generation || !peer) return;
    let packets = 0, decoded = 0;
    try {
      const reports = await peer.getStats();
      reports.forEach((report) => {
        if (report.type === "inbound-rtp" && (report.kind || report.mediaType) === "video") {
          packets += report.packetsReceived || 0;
          decoded += report.framesDecoded || 0;
        }
      });
    } catch {}
    if (generation !== this.generation || peer !== this.peer) return;
    this.dispatchProgress(`Camera startup snapshot (${camera}): track=${this.readiness.videoTrack}; readyState=${this.videoElement.readyState}; paused=${this.videoElement.paused}; packets=${packets}; decoded=${decoded}; telemetry=${this.hasFreshTelemetry() ? "fresh" : "missing/stale"}`);
  }

  markTelemetryReceived(types, now = performance.now()) {
    for (const type of types || []) {
      if (LIVE_SERVICES.includes(type)) this.lastTelemetry.set(type, now);
    }
    // A clockSync reply, unknown service or malformed JSON is not telemetry.
    this.readiness.dataReceived = this.hasFreshTelemetry(now);
    if (this.staleServices.length) this.checkTelemetryHealth(now);
  }

  hasFreshTelemetry(now = performance.now()) {
    return LIVE_SERVICES.every((type) => now - (this.lastTelemetry.get(type) ?? -Infinity) <= TELEMETRY_STALE_MS);
  }

  startTelemetryHealth() {
    clearInterval(this.healthTimer);
    clearTimeout(this.startupDiagnosticTimer);
    this.resumeTelemetryHealth();
    this.healthTimer = setInterval(() => this.checkTelemetryHealth(), 1000);
  }

  resumeTelemetryHealth(now = performance.now()) {
    // Give normal background/resume delivery a chance to recover. A warning
    // does not close the peer, alter values or start another reconnect loop.
    this.healthGraceUntil = now + TELEMETRY_STALE_MS;
  }

  checkTelemetryHealth(now = performance.now()) {
    if (globalThis.document?.hidden || now < this.healthGraceUntil) return;
    const staleServices = LIVE_SERVICES.filter((type) => now - (this.lastTelemetry.get(type) ?? -Infinity) > TELEMETRY_STALE_MS);
    if (staleServices.join() === this.staleServices.join()) return;
    this.staleServices = staleServices;
    this.dispatchEvent(new CustomEvent("health", { detail: { staleServices } }));
  }

  async waitForStreams(generation, timeoutMs) {
    const startedAt = Date.now();
    while (generation === this.generation && Date.now() - startedAt < timeoutMs) {
      this.readiness.dataReceived = this.hasFreshTelemetry();
      if (this.readiness.videoReady && this.readiness.dataReceived) return;
      await delay(100);
    }
    if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
    const readiness = { ...this.readiness };
    const missing = LIVE_SERVICES.filter((type) => performance.now() - (this.lastTelemetry.get(type) ?? -Infinity) > TELEMETRY_STALE_MS);
    const message = await describeReadinessFailure(this.peer, this.channel, readiness);
    if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
    const error = new Error(message);
    // A playable camera with an open data channel can precede modelV2 while
    // openpilot's driving model is still starting. Replacing that session is
    // safe and bounded by ConnectionManager's normal retry limit.
    error.retryable = readiness.videoReady && readiness.dataChannelOpen && !readiness.dataReceived;
    if (error.retryable) error.cause = new Error(`Missing or stale telemetry: ${missing.join(", ")}`);
    throw error;
  }

  send(type, data) {
    if (this.channel?.readyState !== "open") return false;
    this.channel.send(JSON.stringify({ type, data }));
    return true;
  }

  switchCamera(camera, timeoutMs = 5000) {
    if (!["road", "wideRoad"].includes(camera)) return Promise.reject(new Error("Unknown road camera."));
    if (!this.sessionLive || this.peer?.connectionState !== "connected" || this.channel?.readyState !== "open") {
      return Promise.reject(new Error("The live camera link is not ready to switch."));
    }
    if (typeof this.videoElement.requestVideoFrameCallback !== "function") {
      return Promise.reject(new Error("This browser needs a replacement session to switch cameras."));
    }
    if (this.cancelCameraSwitch) return Promise.reject(new Error("A camera switch is already pending."));
    const generation = this.generation, peer = this.peer, video = this.videoElement, page = globalThis.document;
    return new Promise((resolve, reject) => {
      let frame, timer, settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        page?.removeEventListener("visibilitychange", onVisibility);
        if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
        if (this.cancelCameraSwitch === cancel) this.cancelCameraSwitch = null;
        if (error) reject(error); else resolve();
      };
      const cancel = () => finish(Object.assign(new Error("The camera switch was cancelled."), { cancelled: true }));
      // Presentation callbacks can pause in the background. Keep the live
      // peer instead of mistaking that pause for a stalled camera/reconnect.
      const onVisibility = () => { if (page.hidden) cancel(); };
      this.cancelCameraSwitch = cancel;
      page?.addEventListener("visibilitychange", onVisibility);
      if (page?.hidden) { cancel(); return; }
      timer = setTimeout(() => finish(new Error("Video stopped advancing during the camera switch.")), timeoutMs);
      try {
        // rx-wb-stg changes the encoder source of the existing video track.
        // No peer, data-channel, adapter or telemetry-health reset is needed.
        if (!this.send("livestreamCameraSwitch", { camera })) throw new Error("Camera control channel closed.");
        frame = video.requestVideoFrameCallback(() => {
          if (generation !== this.generation || peer !== this.peer) cancel();
          else finish();
        });
      } catch (error) { finish(error); }
      // The server has no camera acknowledgement/frame-camera identifier.
      // This observes continuing presentation, not proof of source identity.
    });
  }

  async close({ invalidate = true } = {}) {
    if (invalidate) this.generation += 1;
    this.cancelCameraSwitch?.();
    this.cancelVideoReady?.();
    const channel = this.channel;
    const peer = this.peer;
    this.channel = null;
    this.peer = null;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.sessionLive = false;
    this.readiness = createReadinessState();
    clearInterval(this.healthTimer);
    clearTimeout(this.startupDiagnosticTimer);
    this.healthTimer = null;
    this.lastTelemetry.clear();
    this.healthGraceUntil = 0;
    if (this.staleServices.length) {
      this.staleServices = [];
      this.dispatchEvent(new CustomEvent("health", { detail: { staleServices: [] } }));
    }
    try { channel?.close(); } catch {}
    try { peer?.close(); } catch {}
    if (this.videoElement.srcObject) {
      for (const track of this.videoElement.srcObject.getTracks()) track.stop();
      this.videoElement.srcObject = null;
    }
  }

  dispatchState(state) {
    if (["failed", "disconnected", "offline"].includes(state)) this.cancelCameraSwitch?.();
    this.dispatchEvent(new CustomEvent("state", { detail: state }));
  }

  dispatchProgress(message) {
    this.dispatchEvent(new CustomEvent("progress", { detail: message }));
  }
}

export function createReadinessState() {
  return { peerConnected: false, dataChannelOpen: false, dataReceived: false, videoTrack: false, videoReady: false };
}

export function readinessFailureMessage(readiness, videoStats = {}) {
  if (!readiness.dataChannelOpen) {
    return "The secure link connected, but the comma never opened its telemetry channel. Restart webrtcd (or reboot the comma) and try again.";
  }
  if (!readiness.dataReceived && !readiness.videoReady) {
    return "The telemetry channel opened, but the comma sent neither data nor camera frames. Confirm OpviewEnabled is on, put the comma onroad, and restart webrtcd.";
  }
  if (!readiness.dataReceived) {
    return "Camera live; waiting for carState/modelV2 data.";
  }
  if ((videoStats.packetsReceived || 0) > 0 && (videoStats.framesDecoded || 0) === 0) {
    return "Telemetry is live and camera packets arrived, but this browser could not decode the H.264 video stream.";
  }
  if (readiness.videoTrack) {
    return "Telemetry is live and the camera track connected, but no playable camera frame arrived. Put the comma onroad and confirm the road camera is active.";
  }
  return "Telemetry is live, but the comma did not provide a road-camera track. Put the comma onroad and restart webrtcd.";
}

async function describeReadinessFailure(peer, channel, readiness) {
  const videoStats = {};
  try {
    const stats = await peer?.getStats();
    stats?.forEach((report) => {
      if (report.type === "inbound-rtp" && report.kind === "video") {
        videoStats.packetsReceived = report.packetsReceived;
        videoStats.framesDecoded = report.framesDecoded;
      }
    });
  } catch {}
  const state = { ...readiness, dataChannelOpen: readiness.dataChannelOpen || channel?.readyState === "open" };
  return readinessFailureMessage(state, videoStats);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function preferH264(sdp) {
  const lines = sdp.split("\r\n");
  const videoIndex = lines.findIndex((line) => line.startsWith("m=video"));
  if (videoIndex === -1) return sdp;
  const h264 = lines.flatMap((line) => {
    const match = line.match(/^a=rtpmap:(\d+) H264\/90000/i);
    return match ? [match[1]] : [];
  });
  if (!h264.length) return sdp;
  const related = lines.flatMap((line) => {
    const match = line.match(/^a=fmtp:(\d+) apt=(\d+)/);
    return match && h264.includes(match[2]) ? [match[1]] : [];
  });
  const preferred = [...h264, ...related];
  const parts = lines[videoIndex].split(" ");
  const others = parts.slice(3).filter((payload) => !preferred.includes(payload));
  lines[videoIndex] = [...parts.slice(0, 3), ...preferred, ...others].join(" ");
  return lines.join("\r\n");
}

export async function resolveBridgeServices(device, fetchImpl = fetch) {
  for (const profile of SERVICE_PROFILES) {
    const services = [...BASE_BRIDGE_SERVICES_OUT, profile.calibration, profile.camera];
    const query = encodeURIComponent(`${profile.calibration},${profile.camera}`);
    const options = {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    };
    options.targetAddressSpace = "local";

    let response;
    try {
      response = await fetchImpl(`${deviceBaseUrl(device)}/schema?services=${query}`, options);
    } catch (error) {
      throw new Error("The browser could not inspect the comma service schema. Allow local-network access and add the rx-wb browser CORS patch.", { cause: error });
    }
    if (response.ok) {
      const optional = await resolveOptionalServices(device, fetchImpl);
      return [...services, ...optional];
    }
  }
  throw new Error("This comma does not expose a compatible calibration and road-camera service pair.");
}

async function resolveOptionalServices(device, fetchImpl) {
  const query = encodeURIComponent(OPTIONAL_BRIDGE_SERVICES_OUT.join(","));
  const options = schemaOptions();
  try {
    const response = await fetchImpl(`${deviceBaseUrl(device)}/schema?services=${query}`, options);
    if (response.ok) return [...OPTIONAL_BRIDGE_SERVICES_OUT];
  } catch {}

  const supported = [];
  for (const service of OPTIONAL_BRIDGE_SERVICES_OUT) {
    try {
      const response = await fetchImpl(`${deviceBaseUrl(device)}/schema?services=${encodeURIComponent(service)}`, schemaOptions());
      if (response.ok) supported.push(service);
    } catch {}
  }
  return supported;
}

function schemaOptions() {
  const options = {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    signal: AbortSignal.timeout(5000)
  };
  options.targetAddressSpace = "local";
  return options;
}

async function postStreamWithFallback(device, sdp, camera, initialServices) {
  let services = [...initialServices];
  for (let attempt = 0; attempt <= OPTIONAL_BRIDGE_SERVICES_OUT.length; attempt += 1) {
    try {
      return await postStream(device, sdp, camera, services);
    } catch (error) {
      const rejected = error.rejectedService;
      if (!rejected || !OPTIONAL_BRIDGE_SERVICES_OUT.includes(rejected)) throw error;
      services = services.filter((service) => service !== rejected);
    }
  }
  throw new Error("The comma rejected the optional telemetry service set.");
}

async function postStream(device, sdp, camera, services) {
  const options = {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildStreamRequest(sdp, camera, services)),
    signal: AbortSignal.timeout(35000)
  };
  options.targetAddressSpace = "local";
  let response;
  try {
    response = await fetch(`${deviceBaseUrl(device)}/stream`, options);
  } catch (error) {
    throw new Error("The browser could not reach the stream endpoint. Allow local-network access and confirm the device has the OP WebView CORS compatibility change.", { cause: error });
  }
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`webrtcd returned ${response.status}${body ? `: ${body}` : ""}`);
    try {
      const message = String(JSON.parse(body).message || "");
      error.rejectedService = message.match(/KeyError:\s*['\"]([^'\"]+)['\"]/)?.[1] || null;
    } catch {}
    throw error;
  }
  try {
    const answer = JSON.parse(body);
    if (!answer.sdp || !answer.type) throw new Error("Incomplete SDP answer");
    return answer;
  } catch (error) {
    throw new Error("webrtcd returned an invalid SDP answer.", { cause: error });
  }
}

export function buildStreamRequest(sdp, camera, services) {
  return {
    sdp,
    cameras: [camera],
    enabled: true,
    bridge_services_in: [],
    bridge_services_out: services
  };
}

function waitForIceGathering(peer, timeoutMs) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    function onChange() {
      if (peer.iceGatheringState === "complete") done();
    }
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

function waitForPeerConnection(peer, timeoutMs) {
  if (peer.connectionState === "connected") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out while establishing the WebRTC connection.")), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      peer.removeEventListener("connectionstatechange", onChange);
      error ? reject(error) : resolve();
    }
    function onChange() {
      if (peer.connectionState === "connected") finish();
      else if (["failed", "closed"].includes(peer.connectionState)) finish(new Error(`WebRTC connection ${peer.connectionState}.`));
    }
    peer.addEventListener("connectionstatechange", onChange);
  });
}

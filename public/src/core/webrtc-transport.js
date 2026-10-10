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
  "driverMonitoringState"
]);

// openpilot renamed these services after the native opview client was released.
// Probe the device before creating a SubMaster because requesting even one
// unknown service makes the entire WebRTC stream request fail.
export const SERVICE_PROFILES = Object.freeze([
  Object.freeze({ calibration: "extrinsicsCalibration", camera: "narrowRoadCameraState" }),
  Object.freeze({ calibration: "liveCalibration", camera: "roadCameraState" })
]);

export class WebRTCTransport extends EventTarget {
  constructor(videoElement) {
    super();
    this.videoElement = videoElement;
    this.peer = null;
    this.channel = null;
    this.generation = 0;
    this.readiness = createReadinessState();
  }

  async connect(device, { camera = "road" } = {}) {
    const generation = ++this.generation;
    await this.close({ invalidate: false });
    this.readiness = createReadinessState();
    this.dispatchState("connecting");
    this.dispatchProgress("Creating a secure camera and telemetry session…");

    const peer = new RTCPeerConnection({ iceServers: [] });
    this.peer = peer;
    peer.addEventListener("connectionstatechange", () => {
      if (generation !== this.generation || peer !== this.peer) return;
      const state = peer.connectionState;
      this.readiness.peerConnected = state === "connected";
      if (state === "connected") {
        this.dispatchState("waiting");
        this.dispatchProgress("Secure link established. Waiting for camera and telemetry…");
      } else {
        this.dispatchState(["failed", "disconnected", "closed"].includes(state) ? "failed" : "connecting");
      }
    });
    peer.addEventListener("track", (event) => {
      if (generation !== this.generation || event.track.kind !== "video") return;
      this.readiness.videoTrack = true;
      this.videoElement.srcObject = event.streams[0] || new MediaStream([event.track]);
      const markFrame = () => this.markVideoReady(generation);
      this.videoElement.addEventListener("playing", markFrame, { once: true });
      this.videoElement.addEventListener("loadeddata", markFrame, { once: true });
      event.track.addEventListener("unmute", () => {
        this.videoElement.play().catch((error) => this.dispatchProgress(`Camera playback was blocked: ${error.message}`));
      }, { once: true });
      this.videoElement.play().then(() => {
        if (typeof this.videoElement.requestVideoFrameCallback === "function") {
          this.videoElement.requestVideoFrameCallback(markFrame);
        } else if (this.videoElement.readyState >= 2) {
          markFrame();
        }
      }).catch((error) => this.dispatchProgress(`Camera playback was blocked: ${error.message}`));
    });
    peer.addEventListener("datachannel", (event) => this.attachChannel(event.channel, generation));

    // Match gerrylum/opview: telemetry is time-sensitive, so stale packets are
    // dropped instead of holding up every later update on an unreliable link.
    this.attachChannel(peer.createDataChannel("data", { ordered: false, maxRetransmits: 0 }), generation);
    peer.addTransceiver("video", { direction: "recvonly" });
    try {
      const offer = await peer.createOffer();
      offer.sdp = preferH264(offer.sdp || "");
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, 5000);
      if (generation !== this.generation) return;

      this.dispatchProgress("Requesting the road camera and openpilot data…");
      const services = await resolveBridgeServices(device);
      const response = await postStreamWithFallback(device, peer.localDescription?.sdp || offer.sdp, camera, services);
      if (generation !== this.generation) return;
      await peer.setRemoteDescription(new RTCSessionDescription(response));
      await waitForPeerConnection(peer, 15000);
      await this.waitForStreams(generation, 20000);
      if (generation === this.generation) {
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
    channel.addEventListener("error", () => {
      if (generation === this.generation) this.dispatchProgress("The telemetry channel reported an error.");
    });
    channel.addEventListener("message", async (event) => {
      if (generation !== this.generation) return;
      let text;
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof Blob) text = await event.data.text();
      else text = new TextDecoder().decode(event.data);
      this.readiness.dataReceived = true;
      this.dispatchEvent(new CustomEvent("data", { detail: text }));
    });
    if (channel.readyState === "open") onOpen();
  }

  markVideoReady(generation) {
    if (generation !== this.generation || this.readiness.videoReady) return;
    this.readiness.videoReady = true;
    this.dispatchEvent(new CustomEvent("video"));
    this.dispatchProgress("Camera is live. Waiting for telemetry data…");
  }

  async waitForStreams(generation, timeoutMs) {
    const startedAt = Date.now();
    while (generation === this.generation && Date.now() - startedAt < timeoutMs) {
      if (this.readiness.videoReady && this.readiness.dataReceived) return;
      await delay(100);
    }
    if (generation !== this.generation) throw new Error("The connection attempt was cancelled.");
    throw new Error(await describeReadinessFailure(this.peer, this.channel, this.readiness));
  }

  send(type, data) {
    if (this.channel?.readyState !== "open") return false;
    this.channel.send(JSON.stringify({ type, data }));
    return true;
  }

  async close({ invalidate = true } = {}) {
    if (invalidate) this.generation += 1;
    const channel = this.channel;
    const peer = this.peer;
    this.channel = null;
    this.peer = null;
    this.readiness = createReadinessState();
    try { channel?.close(); } catch {}
    try { peer?.close(); } catch {}
    if (this.videoElement.srcObject) {
      for (const track of this.videoElement.srcObject.getTracks()) track.stop();
      this.videoElement.srcObject = null;
    }
  }

  dispatchState(state) {
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
    return "The camera is live, but no telemetry arrived. Confirm the rx-wb OPView support is enabled and restart webrtcd.";
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

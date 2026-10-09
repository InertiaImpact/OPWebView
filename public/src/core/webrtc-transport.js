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
  }

  async connect(device, { camera = "road" } = {}) {
    const generation = ++this.generation;
    await this.close({ invalidate: false });
    this.dispatchState("connecting");

    const peer = new RTCPeerConnection({ iceServers: [] });
    this.peer = peer;
    peer.addEventListener("connectionstatechange", () => {
      if (generation !== this.generation) return;
      const state = peer.connectionState;
      this.dispatchState(state === "connected" ? "connected" : ["failed", "disconnected", "closed"].includes(state) ? "failed" : "connecting");
    });
    peer.addEventListener("track", (event) => {
      if (generation !== this.generation || event.track.kind !== "video") return;
      this.videoElement.srcObject = event.streams[0] || new MediaStream([event.track]);
      this.videoElement.play().catch(() => {});
      this.dispatchEvent(new CustomEvent("video"));
    });
    peer.addEventListener("datachannel", (event) => this.attachChannel(event.channel, generation));

    this.attachChannel(peer.createDataChannel("data"), generation);
    peer.addTransceiver("video", { direction: "recvonly" });
    const offer = await peer.createOffer();
    offer.sdp = preferH264(offer.sdp || "");
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, 2500);
    if (generation !== this.generation) return;

    const services = await resolveBridgeServices(device);
    const response = await postStream(device, peer.localDescription?.sdp || offer.sdp, camera, services);
    if (generation !== this.generation) return;
    await peer.setRemoteDescription(new RTCSessionDescription(response));
    await waitForPeerConnection(peer, 15000);
    if (generation === this.generation) this.dispatchState("connected");
  }

  attachChannel(channel, generation) {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", async (event) => {
      if (generation !== this.generation) return;
      let text;
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof Blob) text = await event.data.text();
      else text = new TextDecoder().decode(event.data);
      this.dispatchEvent(new CustomEvent("data", { detail: text }));
    });
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
    if (response.ok) return services;
  }
  throw new Error("This comma does not expose a compatible calibration and road-camera service pair.");
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
  if (!response.ok) throw new Error(`webrtcd returned ${response.status}${body ? `: ${body}` : ""}`);
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

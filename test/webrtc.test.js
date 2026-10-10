import test from "node:test";
import assert from "node:assert/strict";
import { buildStreamRequest, preferH264, resolveBridgeServices } from "../public/src/core/webrtc-transport.js";

test("preferH264 moves H264 and its RTX payload before VP8", () => {
  const sdp = [
    "v=0",
    "m=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103",
    "a=rtpmap:96 VP8/90000",
    "a=rtpmap:97 rtx/90000",
    "a=fmtp:97 apt=96",
    "a=rtpmap:102 H264/90000",
    "a=rtpmap:103 rtx/90000",
    "a=fmtp:103 apt=102",
    ""
  ].join("\r\n");
  assert.match(preferH264(sdp), /m=video 9 UDP\/TLS\/RTP\/SAVPF 102 103 96 97/);
});

test("uses current cereal service names when the device exposes them", async () => {
  const urls = [];
  const services = await resolveBridgeServices({ host: "192.168.1.10", port: 5001 }, async (url) => {
    urls.push(url);
    return { ok: true };
  });

  assert.match(urls[0], /extrinsicsCalibration%2CnarrowRoadCameraState/);
  assert.ok(services.includes("extrinsicsCalibration"));
  assert.ok(services.includes("narrowRoadCameraState"));
  assert.ok(services.includes("driverMonitoringState"));
  assert.ok(services.includes("carControl"));
  assert.ok(!services.includes("liveCalibration"));
});

test("falls back to legacy opview cereal service names", async () => {
  let requiredCalls = 0;
  const services = await resolveBridgeServices({ host: "192.168.1.10", port: 5001 }, async (url) => {
    if (url.includes("extrinsicsCalibration") || url.includes("liveCalibration")) requiredCalls += 1;
    return { ok: url.includes("liveCalibration") };
  });

  assert.equal(requiredCalls, 2);
  assert.ok(services.includes("liveCalibration"));
  assert.ok(services.includes("roadCameraState"));
});

test("builds the rx-wb stream request with streaming enabled", () => {
  const services = ["carState", "modelV2"];
  assert.deepEqual(buildStreamRequest("offer-sdp", "road", services), {
    sdp: "offer-sdp",
    cameras: ["road"],
    enabled: true,
    bridge_services_in: [],
    bridge_services_out: services
  });
});

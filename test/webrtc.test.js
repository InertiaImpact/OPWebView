import test from "node:test";
import assert from "node:assert/strict";
import { preferH264, resolveBridgeServices } from "../public/src/core/webrtc-transport.js";

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
  assert.ok(!services.includes("liveCalibration"));
});

test("falls back to legacy opview cereal service names", async () => {
  let calls = 0;
  const services = await resolveBridgeServices({ host: "192.168.1.10", port: 5001 }, async () => {
    calls += 1;
    return { ok: calls === 2 };
  });

  assert.equal(calls, 2);
  assert.ok(services.includes("liveCalibration"));
  assert.ok(services.includes("roadCameraState"));
});

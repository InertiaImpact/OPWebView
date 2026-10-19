# Camera handoff options

Updated 2026-10-18. The MADS color release changed no handoff behavior. DEV's `2026.10.18-live-camera.1-dev` now implements the existing in-session switch and the overlay continuity changes below; the remaining options are planning only.

## Why switching is still visible

The earlier browser implementation replaced the WebRTC session for every camera change, interrupting both video and telemetry. The current rx-wb-stg server also stops an existing session before creating its replacement; opening a hidden second connection cannot keep the old one live without server changes. However, the server already handles `livestreamCameraSwitch` on the existing data channel, and its video track has `switch_camera`. The earlier conclusion that an in-session switch necessarily needs a comma patch was incorrect. See [session handling and control messages](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/webrtcd.py) and [video track](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/device/video.py).

The previous snapshot mask also captured the oversized video element rather than the exact viewport crop, baked in a frozen overlay, and hid the actual overlay. DEV now captures only the visible video below the continuously rendered overlay. During reconnect fallback it holds the old camera projection until the replacement presents a frame, rather than changing it at negotiation start. Presentation callbacks are preferred over `loadeddata`/`playing` where supported.

## Current dev behavior and limits

- Normal automatic switching sends `livestreamCameraSwitch` without replacing the peer/video track, clearing the telemetry adapter, hiding the overlay, or resetting telemetry health. The same 10/15 m/s hysteresis and serialized latest-mode handling remain.
- Camera geometry updates after the next presented frame. This is not source confirmation: the server sends no camera acknowledgement/frame-camera identity, and the existing data channel is unordered/unreliable. A lost command or an already-buffered old frame cannot be positively distinguished. Parked testing is required; exact frame-camera synchronization would need a protocol improvement, which is not part of this change.
- If presentation does not advance for five seconds, or the browser lacks presentation callbacks, the existing reconnect path is used and logged as `camera-switch-fallback`. Telemetry can briefly gap during that fallback, but the overlay is no longer hidden or baked into the snapshot. During any actual telemetry gap it can only retain the last received model, not manufacture live data.
- Background/PiP keeps the current live camera rather than starting source changes whose presentation callbacks may pause. A pending switch is cancelled without reconnecting; foreground telemetry re-evaluates the latest mode. Disconnect, bounded link recovery and offline installation remain intact. No comma files/settings, bitrate policy or device process were changed.

## Options, in recommended order

1. **Existing in-session camera switch (implemented on dev):** test on the device before promotion; measure keyframe/decoder behavior and camera/overlay alignment. No new server command or comma patch is needed.
2. **Browser-only polish (partially implemented on dev):** exact viewport capture, held fallback projection and video-only crossfade are in place. The overlay remains visible. A delayed switching badge remains optional; do not conceal prolonged frozen video.
3. **Make-before-break:** change the server to permit bounded overlap, keep the old live image until the new peer presents a frame, then swap. More session/decoder complexity and temporary resource use; isolate telemetry ownership, handle timeout/cancellation, and measure comma load before adoption. Not supported by the current server policy.
4. **Both cameras in one session:** the request already accepts multiple cameras, but browser negotiation, decoder use and camera availability need testing. Instant local selection trades for continuous extra bandwidth/resources. Not the first choice for this lightweight viewer.

A fixed-camera preference or minimum dwell time could reduce switching, but changes automatic camera behavior rather than fixing the handoff.

## Video quality findings

The web app does not request reduced quality or re-encode the received video. rx-wb-stg starts its automatic bitrate controller at the high target (default 5 Mbps, overridable with `STREAM_BITRATE`), then steps down to 1.5 or 0.5 Mbps on packet loss. Recovery requires zero reported loss and backs off after repeated drops. The hardware encoder also uses variable-bitrate, constant-frame-rate mode. Source: [controller](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/webrtcd.py), [encoder](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/loggerd/encoder/v4l_encoder.cc).

Configured livestream sizes are 1280×720 on MICI and 1152×720 on TIZI; other devices retain input dimensions. The configured frame rate is 20 fps. These are source settings, not a measurement of the user's active session. Viewport cropping/enlargement can magnify compression. Source: [logger configuration](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/loggerd/loggerd.h).

Before changing quality policy, measure received resolution, fps, bitrate and packet loss via browser stats. A future Auto/High control can use the existing `livestreamSettings` command; forcing High may worsen loss/stalls, and cannot restore detail removed by source downscaling. No quality behavior changed during this investigation.

## Verification before shipping a handoff change

- Test road↔wide switches, fullscreen, resize, foreground return and reduced motion.
- Preserve widgets, alerts and truthful stale-data indicators throughout the handoff.
- Verify snapshot/video/overlay crop alignment and camera calibration at the swap.
- Exercise slow negotiation, missing camera, cancellation and reconnect failures.
- Measure first-frame latency and device load while parked; never interact while driving.

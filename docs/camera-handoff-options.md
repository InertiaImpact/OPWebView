# Camera handoff options

Planning only, 2026-10-18. No handoff behavior changed in the MADS color release.

## Why switching is still visible

The browser tears down the WebRTC session and negotiates another camera, interrupting both video and telemetry. The current rx-wb-stg server also stops the existing session before creating its replacement; opening a hidden second connection cannot keep the old one live without server changes. See [handle_get_stream](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/webrtcd.py).

The snapshot mask has two additional presentation risks: it captures the oversized video element rather than the exact visible viewport crop, which can stretch the frozen image; and it reveals the replacement on `loadeddata`/`playing`, potentially before a frame is actually presented. Camera projection also changes before the replacement becomes visible.

## Options, in recommended order

1. **Browser-only polish:** capture the exact viewport crop, keep old projection until the new presented frame, then use a short crossfade. Delay the switching badge for brief handoffs; clearly indicate an extended frozen frame rather than hiding a prolonged outage. This removes jumps/flicker, not negotiation time. No comma patch needed.
2. **Persistent session/source switch:** add a comma-side camera-selection message that switches the existing video sender, leaving ICE and telemetry alive. Best route to genuinely shorter pauses; must verify encoder/source-switch and keyframe behavior. Synchronize the new camera identity with displayed frames before changing overlay calibration.
3. **Make-before-break:** change the server to permit bounded overlap, keep the old live image until the new peer presents a frame, then swap. More session/decoder complexity and temporary resource use; isolate telemetry ownership, handle timeout/cancellation, and measure comma load before adoption. Not supported by the current server policy.
4. **Both cameras in one session:** the request already accepts multiple cameras, but browser negotiation, decoder use and camera availability need testing. Instant local selection trades for continuous extra bandwidth/resources. Not the first choice for this lightweight viewer.

A fixed-camera preference or minimum dwell time could reduce switching, but changes automatic camera behavior rather than fixing the handoff.

## Verification before shipping a handoff change

- Test road↔wide switches, fullscreen, resize, foreground return and reduced motion.
- Preserve widgets, alerts and truthful stale-data indicators throughout the handoff.
- Verify snapshot/video/overlay crop alignment and camera calibration at the swap.
- Exercise slow negotiation, missing camera, cancellation and reconnect failures.
- Measure first-frame latency and device load while parked; never interact while driving.

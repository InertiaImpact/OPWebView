# Architecture

## Product boundary

OP WebView is a viewer, not a driving controller. It requests camera and read-only cereal services, projects the supplied model output, and renders local UI. It does not infer lanes from video, publish control messages, or require a cloud backend.

## Layering

The app is framework-free. This keeps the GitHub Pages artifact static and the offline release small.

- `core/device-discovery.js` owns saved pairing and browser-safe discovery providers.
- `core/startup-connection.js` coordinates automatic discovery, saved-device priority and the five-second new-device countdown on dev.
- `core/webrtc-transport.js` owns SDP exchange, H.264 preference, media, and the data channel.
- `core/connection-manager.js` owns retries, camera switching, and wake lock lifecycle.
- `core/telemetry-adapter.js` turns a fragmented/concatenated JSON stream into messages.
- `core/state.js` is the normalized UI state and derived speed model.
- `render/projection.js` is pure projection math and has no DOM dependency.
- `render/overlay-renderer.js` paints model geometry on a device-pixel-ratio-aware canvas.
- `widgets/widget-manager.js` owns widget definitions, visibility, and persisted percentage-based layout.
- On dev, overlay paints are coalesced and limited to relevant inputs; ordinary widget paints update values/visibility without rewriting geometry. Torque/confidence retain their SVG nodes while animating, using the same presentation math as static rendering.
- `core/storage.js` validates stored records and supports safe, per-key migration on dev.
- `service-worker.js` caches only same-origin application code. It never intercepts device traffic.

## Widget extension model

Each widget is a declarative entry containing an ID, title, visual role, and render function. Adding a widget does not require changes to drag/resize/persistence behavior. The Classic, Enhanced, and Detailed presets are immutable starting points; applying an edit creates a custom working layout. Named snapshots and the current working layout are stored in `localStorage` and remain device-local and available offline.

The editor uses percentage coordinates so a layout survives different screen sizes and orientations. On dev, editing menus overlay the unchanged widget workspace and collapse independently. The version-two persistence schema migrates the original five-widget layout without making newly added widgets unexpectedly visible. See [stored-data compatibility](stored-data.md).

## Discovery strategy

Native opview discovers `_ssh._tcp` Bonjour services. A normal GitHub-hosted page cannot enumerate DNS-SD services. The browser implementation therefore:

1. Lists saved devices immediately.
2. Probes saved hosts and `comma.local`; dev does this on page load, prioritizing previously connected devices.
3. Tries bounded private /24 scans when saved addresses or browser ICE candidates reveal a subnet.
4. Accepts a hostname or local IP when automatic discovery cannot find the device.
5. Persists successful pairings locally. On dev, new devices get a five-second countdown before automatic connection.

`DeviceDiscovery` is isolated so a WebMCP helper, companion service, QR pairing, or a future browser discovery API can be added later.

## Hosting decision

GitHub Pages is sufficient and desirable for the application shell:

- no server rendering or secrets are required;
- HTTPS satisfies PWA and service-worker requirements;
- the app can be installed after one online visit and opened offline;
- camera and telemetry remain on the LAN via peer-to-peer WebRTC.

The local device must opt into browser cross-origin access for the SDP POST. This is a device compatibility concern, not a reason to add a cloud relay. A cloud relay would add latency and move sensitive drive video off the local network.

## Verification stages

1. Pure unit tests for stream framing, SDP ordering, and projection math.
2. Browser smoke test with demo telemetry, offline-cache inspection, and layout persistence.
3. Same-LAN hardware test on the target Android browser.
4. Calibration/alignment comparison against the native opview client for road and wide-road cameras.
5. Long-duration thermal, reconnect, and background/resume testing on the target device.

# Device-side browser compatibility

## Why this is needed

The native opview client can POST directly to `http://<device>:5001/stream`. A web page has an origin, so the browser first requires a successful CORS preflight for the JSON POST and then requires an `Access-Control-Allow-Origin` header on the SDP response.

Stock openpilot versions targeted by the included patch start `webrtcd` only for livestream/not-car conditions and default the HTTP listener to `127.0.0.1`. Behavior depends on the installed revision: a phone on Wi-Fi cannot assume port 5001 is exposed while driving.

Depending on the fork and version, three compatibility changes may be required:

1. Start `webrtcd` and `stream_encoderd` while on-road.
2. Bind `webrtcd` to `0.0.0.0` so the LAN can reach port 5001.
3. Answer browser CORS preflights and attach the CORS response headers.

Dragonpilot and other forks that already support the native opview client may already provide the first two. They still need to be checked for browser CORS support.

## gerrylum/openpilot `rx-wb-stg` (current tested target)

The [checked revision `7dd9234`](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/webrtcd.py) includes CORS headers and the browser preflight handler, in addition to on-road streaming and LAN binding when `OpviewEnabled` is enabled. **No additional browser patch is needed for that revision.** Enable OPView streaming in the device's developer settings and allow local-network access in the viewing browser. Discovery still requires the daemon to be running, normally on-road.

See [the pinned telemetry comparison](rx-wb-stg-telemetry.md) for rate changes and remaining indicator precision limitations. These notes describe inspected revisions, not a guarantee about every future branch update.

## Older gerrylum/openpilot `rx-wb`

The `rx-wb` branch at commit `0bbf417` already includes the device-side opview work that a native client needs:

- an **opview Screen Streaming** / **opview streaming** developer toggle backed by `OpviewEnabled`;
- on-road startup of both `stream_encoderd` and `webrtcd` when that toggle is enabled;
- a `0.0.0.0` WebRTC listener while opview is enabled;
- opview-specific telemetry rate limiting, compact model messages, and sessions without the stock five-minute timeout.

That revision lacks CORS headers, and its `OPTIONS` handler returns 405 for `/stream`. For an unpatched checkout of that revision, use [gerrylum-rx-wb-browser-cors.patch](../device/gerrylum-rx-wb-browser-cors.patch). Do not apply it to rx-wb-stg or blindly reapply it after a fork incorporates the fix. The full stock-openpilot patch is not needed because streaming and LAN-listener changes are already present.

After applying it, reboot or restart openpilot. On the comma, enable **Settings → Developer → Show advanced controls → opview Screen Streaming**. The branch notes that the toggle takes effect the next time the car is turned on. The WebRTC daemon is intentionally available for opview while the car is on-road, so browser discovery will not succeed while the car is off unless another livestream condition has started it.

The web client probes the cereal schema and automatically selects this branch's current `extrinsicsCalibration` and `narrowRoadCameraState` names, while retaining compatibility with older opview builds that used `liveCalibration` and `roadCameraState`.

## Other stock-openpilot revisions

The included [openpilot-webrtcd-cors.patch](../device/openpilot-webrtcd-cors.patch) is a reference compatibility change; check it against your exact checkout before applying. Despite the filename, it covers the full browser-streaming compatibility set:

- starts the streaming encoder and WebRTC daemon while on-road;
- binds the WebRTC HTTP listener to the LAN;
- answers `OPTIONS` with HTTP 204;
- permits `GET`, `HEAD`, `POST`, and `OPTIONS`;
- permits the `Content-Type` request header;
- returns an `Access-Control-Allow-Origin` value;
- includes the legacy private-network opt-in header for compatible Chrome versions.

Only make device changes or restart the manager/reboot while parked and off-road. Keep normal browser Local Network Access permission enabled for the OP WebView origin.

For a tighter deployment, replace the wildcard origin with your exact Pages origin, for example:

```text
https://inertiaimpact.github.io
```

The URL path is not part of an origin, so `/OPWebView/` is intentionally omitted.

## Older forks

Some forks use an aiohttp-based `webrtcd` implementation rather than `BaseHTTPRequestHandler`. Add equivalent CORS middleware and an `OPTIONS /stream` route. The required response headers are:

```text
Access-Control-Allow-Origin: https://inertiaimpact.github.io
Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Private-Network: true
Vary: Origin
```

Do not proxy the video through GitHub Pages. The SDP exchange should remain a direct local HTTP request and the resulting video/data connection should remain peer-to-peer WebRTC.

## Can this be bypassed temporarily?

There is no page-only CORS bypass. A `no-cors` request returns an opaque response, so JavaScript cannot read the SDP answer needed to establish WebRTC. Local Network Access permission relaxes HTTPS-to-local-HTTP restrictions, but it does not make a CORS-blocked response readable.

Reasonable temporary test options are:

- Apply the patch directly to the comma's current checkout and restart it. This may be overwritten by a later software update, but requires nothing on the viewing phone.
- Use a small HTTP relay on a laptop on the same LAN that forwards only `/stream` and `/schema` to the comma and adds the response headers. This is useful for bench testing, but the laptop must remain present and it is not the final offline architecture.
- If the installed fork already exposes LAN-accessible `webrtcd`, add only the CORS/`OPTIONS` portion of the patch.

Disabling browser security or installing a CORS-bypass extension is intentionally not supported. It would undermine the no-APK/no-companion goal and is not a safe deployment path.

## Quick readiness checks

Before testing the hosted page, confirm from another device on the same Wi-Fi that the comma responds at:

```text
http://COMMA_IP:5001/schema?services=deviceState
```

Then confirm an `OPTIONS` request to `/stream` returns 204 with `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers`. Passing both checks means the browser can attempt the real SDP/WebRTC session.

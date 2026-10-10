# OP WebView

OP WebView is an installable, local-first web client for the openpilot `webrtcd` stream. It receives the road camera over WebRTC, consumes cereal telemetry on the WebRTC data channel, and projects the path, lane lines, road edges, and lead indicators in the browser.

This first milestone includes:

- WebRTC road-camera streaming with H.264 preference
- Telemetry parsing for the stock on-road UI services
- Canvas-based path, lane, road-edge, and lead-vehicle rendering
- Twenty live-data widgets spanning speed, limits, road name, driver monitoring, model confidence, steering, lead, longitudinal control, and device health
- Built-in Classic, Enhanced, and Detailed layouts adapted from gerrylum's OPView layouts branch
- Named custom layouts saved locally, with recall, deletion, visibility controls, drag, resize, and preset-aware reset
- Saved-device discovery with a `comma.local` probe and manual local-IP entry
- Road/wide-road camera switching with the same speed hysteresis as opview
- PWA installation, offline shell caching, standalone display, and screen wake lock
- A no-hardware demo mode for validating the layout and renderer
- A GitHub Pages deployment workflow

## Run locally

No dependencies or build step are required.

```powershell
npm test
npm run serve
```

Open `http://127.0.0.1:4173`. Use **Demo** to exercise the renderer, or **Connect** and enter the comma device's local IP or hostname.

## Device requirements

The comma device must be on the same network and expose `webrtcd` on port 5001. Current stock openpilot needs its streaming processes enabled on-road, its listener exposed to the LAN, and browser CORS handling. The checked `gerrylum/openpilot` `rx-wb` branch already supplies the streaming and LAN changes, but still needs the included CORS-only patch. Apply the version-specific compatibility change described in [docs/device-setup.md](docs/device-setup.md) before using the GitHub Pages build.

Chrome 142 and newer can grant an HTTPS page access to HTTP devices on the local network. Other browsers may still block the HTTPS-to-local-HTTP SDP request. The WebRTC media and data channel remain peer-to-peer; GitHub Pages only serves the cached application code.

Normal web pages cannot enumerate mDNS/DNS-SD services. OP WebView therefore preserves discovery through pluggable browser-safe providers: recently connected devices, a known `comma.local` hostname, and manual pairing. A future local discovery helper can be added behind the same interface without changing connection or UI code.

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. In the repository settings:

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `main` or run the workflow manually.

The action tests the JavaScript and deploys the contents of `public/`. All runtime URLs are relative, so the app works at the project path `https://inertiaimpact.github.io/OPWebView/` as well as on a custom domain.

GitHub Pages is an appropriate host because this application is entirely static. Camera video and telemetry do not transit GitHub. The one compatibility dependency is the local device's browser-facing CORS response described above.

## Architecture

```text
Device discovery / saved pairing
              │
              ▼
     ConnectionManager ───── camera hysteresis / retry / wake lock
              │
      ┌───────┴────────┐
      ▼                ▼
WebRTC video      cereal JSON data channel
      │                │
  <video>       CerealAdapter → TelemetryStore
      │                          │
      └──────────────┬───────────┘
                     ▼
          Canvas model renderer + movable widgets
```

See [docs/architecture.md](docs/architecture.md) for design decisions and extension points.

## Browser support

- Primary target: current Chrome/Chromium on Android and desktop
- PWA install and offline launch require HTTPS (or localhost during development)
- Local-network access requires the browser permission prompt on current Chrome
- iOS/Safari can load the UI, but direct HTTP local-device access from an HTTPS origin is not currently a supported deployment target

## Attribution

The protocol, state mapping, projection math, and on-road rendering behavior are adapted from [`eFiniLan/opview`](https://github.com/eFiniLan/opview), including [`gerrylum/opview`](https://github.com/gerrylum/opview)'s `layouts` branch, and openpilot. Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before distribution or commercial use.

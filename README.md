# OP WebView

OP WebView is an installable, local-first web client for the openpilot `webrtcd` stream. It receives the road camera over WebRTC, consumes cereal telemetry on the WebRTC data channel, and projects the path, lane lines, road edges, and lead indicators in the browser.

This is a supplemental viewer, not a driving controller or replacement for the comma display. Set up and test it while parked.

Features:

- WebRTC road-camera streaming with H.264 preference
- Telemetry parsing for the stock on-road UI services
- Canvas-based path, lane, road-edge, and lead-vehicle rendering
- Twenty live-data widgets spanning speed, limits, road name, driver monitoring, model confidence, steering, lead, longitudinal control, and device health
- Built-in Classic, Enhanced, and Detailed layouts adapted from gerrylum's OPView layouts branch
- Named custom layouts saved locally, with recall, deletion, visibility controls, drag, resize, and preset-aware reset
- Current-network discovery with a parallel `comma.local` check and manual local-IP entry
- Road/wide-road camera switching with the same speed hysteresis as opview
- PWA installation, offline shell caching, standalone display, and screen wake lock
- A no-hardware demo mode for validating the layout and renderer
- A GitHub Pages deployment workflow

Use [stable](https://inertiaimpact.github.io/OPWebView/) for released features or [dev](https://inertiaimpact.github.io/OPWebView/dev/) for upcoming changes. Both include automatic discovery/reconnection, floating editing menus, double-tap fullscreen, saved-data migration, and in-session camera switching that retains telemetry. A video-only snapshot masks reconnect fallback without hiding the overlay.

The presets use OPView's reference sizing rather than stretching corner widgets with the window. Detailed includes live ten-second acceleration graphs and folding panels. Small page windows temporarily show speed and torque only; standard video Picture-in-Picture stays camera-only. The full chosen layout restores on return. See [the visual/resize verification notes](docs/hud-visual-pass.md) for reference details, test coverage and Android limitations.

## Run locally

Use Node.js 24 (the CI version). No build step or dependency installation is required to run the checked-in app; the QR library is vendored.

```powershell
npm run check
npm run serve
```

Open `http://127.0.0.1:4173`. On dev, discovery starts automatically and connects to the first verified device immediately. Only devices found on this network appear; old drive addresses are not scanned or listed. Use **+ Add IP address** if discovery misses it, or **Demo** without hardware. Long-press the dashboard to edit; **Done** locks it. Double-tap the live view or demo to enter/exit fullscreen. See [startup and controls](docs/startup-connection.md) for limitations.

Once connected, the device panel and launcher disappear. Reopen **Devices / logs** from the editing Views panel to see found devices and diagnostics. The summary QR retains recent issues; **Full log QR** transfers all stored events across numbered pages. Copy/Download also share the complete log.

## Device requirements

The comma must be on the same network, on-road with OPView streaming enabled, and expose browser-readable `webrtcd` on port 5001. The checked `gerrylum/openpilot` **rx-wb-stg** revision includes browser CORS support; do not reapply the older rx-wb patch to it. Other revisions/forks may need compatibility changes. See [device setup](docs/device-setup.md) and the [pinned telemetry comparison](docs/rx-wb-stg-telemetry.md).

Current Chrome/Chromium is the primary target. Allow local-network access when prompted; permission alone does not bypass device CORS requirements. Other browsers may block HTTPS-to-local-HTTP signaling. Video and telemetry remain peer-to-peer; GitHub Pages serves only the application files.

Web pages cannot enumerate Bonjour services. Dev scans current private subnets exposed by browser ICE candidates/statistics while checking `comma.local` independently. That hostname is not a required fallback. If the browser hides interface addresses and the hostname does not resolve, enter the comma's current IP manually. Logs distinguish hidden interfaces, timeouts, HTTP errors and incompatible schema; network/CORS failures remain indistinguishable when the browser masks the cause.

After a successful online visit/cache installation, install the page as a PWA for offline launch. Offline use still needs a reachable comma on the local network. Updates preserve compatible saved settings and replace the cached app only after a complete release is available; do not routinely clear site data. See [stored-data handling](docs/stored-data.md).

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. In the repository settings:

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `main` or `dev`, or run the workflow manually.

The action checks out and tests **both branches**, then deploys one combined artifact: main at `/OPWebView/` and dev at `/OPWebView/dev/`. It uses Node 24 on Ubuntu 24.04. Do not deploy either branch alone, because Pages replaces the whole site. See [deployment and promotion](docs/development-site.md).

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

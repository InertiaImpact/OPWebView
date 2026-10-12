# Startup discovery and fullscreen (DEV)

On each load, DEV checks the browser's `local-network` permission (with `local-network-access` fallback). If denied, it explains how to allow access in site settings; webpages cannot override a denial. For prompt/unknown states, the local schema fetch attempts to trigger the browser's permission prompt. If the browser requires interaction, use **Scan network** in the floating left device panel. The **+** button opens manual IP entry without automatically focusing the input.

## Floating controls

- The responsive device panel replaces the toolbar/welcome screen. Devices appear as discovery progresses; the `comma.local` fallback is listed only if reachable. **Connect** is shown only for reachable devices and **Demo** hides when one is available.
- A device/wireless icon and **Devices** label toggle the panel: integrated into its open header, or a compact top-left pill when collapsed. **Tools** holds logs, fullscreen and installation. A successful connection hides both the panel and its launcher; reopen **Devices / logs** from the editing Views menu.
- Long-press the full dashboard for 700 ms to edit. Views/saved layouts float left; widget checkboxes float right. Collapse either menu to reach widgets underneath. Neither menu resizes the actual layout, and **Done** stays accessible.
- **Done** or Escape locks editing. Desktop users can also right-click or use Shift+L. Drags, controls and cancelled gestures do not unlock. Compact/camera-only presentation closes editing without changing saved geometry.

## Automatic connection

Saved devices and `comma.local` are probed immediately and in parallel. A reachable previously connected device triggers an immediate connection. The first newly discovered device triggers a five-second delay and is checked again before connection. If a saved device responds during that countdown, it takes priority. Only successful connections enter the saved history from this version onward; older saved entries are retained.

Discovery validates the comma's CORS-readable service schema, not just an open HTTP port. Network scans are limited to known/saved private /24 subnets and those the browser exposes through local ICE candidates. Browsers often hide those addresses, so discovery cannot guarantee finding an unknown IP without a saved address or working `comma.local` hostname.

Cancel, starting demo, manual connection, editing a layout or hiding the page cancels startup scanning/countdowns. An unsuccessful attempt does not spin in an automatic retry loop. Loading the installed app without internet still attempts local discovery: lack of internet does not imply lack of LAN. No data or permission settings are cleared.

Dev reports a live session only after camera playback plus parsed `carState` and `modelV2` messages arrive; a clock-sync reply alone is insufficient. If either core service stops for over five seconds, a quiet “Telemetry delayed” warning flags potentially outdated values. Delivery clears the warning automatically; it does not trigger reconnects. Foreground return has a five-second grace period. Incomplete telemetry buffering is limited to 1,048,576 characters; exceeding it discards damaged data and records a warning without clearing settings.

Double-tap a non-interactive area of the viewer to **toggle** fullscreen while on-road telemetry and a playing WebRTC video are active, or in demo. Double-tap can also exit fullscreen after a stream stops. Buttons, links, inputs, dialogs, side docks, dragging and layout editing are excluded. The second tap toggles fullscreen directly, preserving the browser's user-gesture requirement. The fullscreen button shares the same toggle handler. Native Android video PiP stays camera-only.

Camera handoffs wait for startup/any current negotiation to finish and use the latest Experimental mode and speed, retaining the 10/15 m/s hysteresis. Logs name each handoff and camera track; a delayed startup adds a one-time packet/decode/readiness snapshot after five seconds. Cancellation cannot mark a superseded session connected. These changes do not require clearing site data or modifying the comma.

The camera video is a non-interactive presentation layer; pointer gestures reach the viewer instead of the browser's native video menu. Selection/callouts are disabled on the viewer before the gesture starts, and its context-menu handler runs in capture phase. Buttons, fields and side panels retain their own touch and scrolling behavior.

Browser permission prompts, actual local device reachability and Android fullscreen require a parked hardware test. Unit tests exercise delay/priority/cancellation/permission fallback and gesture boundaries; browser smoke testing does not connect to or change a comma.

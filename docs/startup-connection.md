# Startup discovery and fullscreen (DEV)

On each load, DEV checks the browser's `local-network` permission (with `local-network-access` fallback). If denied, it explains how to allow access in site settings; webpages cannot override a denial. For prompt/unknown states, the local schema fetch attempts to trigger the browser's permission prompt. If the browser requires interaction, use the visible **Scan & connect** button. The hostname/IP input is never automatically focused.

Saved devices and `comma.local` are probed immediately and in parallel. A reachable previously connected device triggers an immediate connection. The first newly discovered device triggers a five-second delay and is checked again before connection. If a saved device responds during that countdown, it takes priority. Only successful connections enter the saved history from this version onward; older saved entries are retained.

Discovery validates the comma's CORS-readable service schema, not just an open HTTP port. Network scans are limited to known/saved private /24 subnets and those the browser exposes through local ICE candidates. Browsers often hide those addresses, so discovery cannot guarantee finding an unknown IP without a saved address or working `comma.local` hostname.

Cancel, starting demo, manual connection, editing a layout or hiding the page cancels startup scanning/countdowns. An unsuccessful attempt does not spin in an automatic retry loop. Loading the installed app without internet still attempts local discovery: lack of internet does not imply lack of LAN. No data or permission settings are cleared.

Double-tap a non-interactive area of the viewer to **enter** fullscreen while on-road telemetry and a playing WebRTC video are active. Buttons, links, inputs, dialogs, dragging, layout editing and demo are excluded. The second tap requests fullscreen directly, preserving the browser's user-gesture requirement. The existing fullscreen button still toggles it. Native Android video PiP stays camera-only.

Browser permission prompts, actual local device reachability and Android fullscreen require a parked hardware test. Unit tests exercise delay/priority/cancellation/permission fallback and gesture boundaries; browser smoke testing does not connect to or change a comma.

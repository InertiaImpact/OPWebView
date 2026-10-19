# Startup discovery and fullscreen (DEV)

On dev, discovery starts as soon as the app module is ready and restarts when an idle page returns to the foreground or its network changes. Cancel pauses automatic discovery until **Scan network** is selected. Manual IP entry also pauses it. Scans prioritize the last verified address from this open page only when it belongs to the freshly detected current subnet; no history is saved or old subnets scanned.

Dev uses rx-wb-stg's existing in-session camera-switch command: the peer, telemetry channel and overlay remain active, with no comma patch. A stalled presentation or older browser falls back to reconnecting; that fallback holds a size-limited video-only snapshot below the visible overlay until replacement video presents a frame. Projection stays on the old camera until then. Reconnect fallback can briefly interrupt telemetry; a continuing frame alone cannot confirm camera identity because the server provides no explicit acknowledgement. See [handoff details and limits](camera-handoff-options.md).

On each load, DEV checks the browser's `local-network` permission (with `local-network-access` fallback). If denied, it explains how to allow access in site settings; webpages cannot override a denial. For prompt/unknown states, the local schema fetch attempts to trigger the browser's permission prompt. If the browser requires interaction, use **Scan network** in the floating left device panel. The **+** button opens manual IP entry without automatically focusing the input.

## Floating controls

Dev editing panels use a single-row preset selector/save form, compact saved-view actions, and a two-column widget list on landscape/tablet screens (one column on narrow screens). Headers remain draggable/collapsible, and the panels never resize the dashboard underneath. Saved names stay accessible through full labels/tooltips even when visually shortened.

- The responsive device panel replaces the toolbar/welcome screen. Only devices positively identified on the current network are listed, including the connected device when reopened. `comma.local` is checked alongside IP scanning and listed only if it responds. **Demo** hides when a device is found.
- A device/wireless icon and **Devices** label toggle the panel: integrated into its open header, or a compact top-left pill when collapsed. **Tools** holds logs, fullscreen and installation. A successful connection hides both the panel and its launcher; reopen **Devices / logs** from the editing Views menu.
- Long-press the full dashboard for 700 ms to edit. Drag widgets by their title bars and resize with their bottom-right handles. Views/saved layouts float left; widget checkboxes float right. Drag either menu by its header (or focus the header and use arrow keys), or collapse it to reach widgets underneath. Menus stay inside the viewport and do not resize the layout; their positions last only for this session. **Done** stays accessible.
- **Done** or Escape locks editing. Desktop users can also right-click or use Shift+L. Drags, controls and cancelled gestures do not unlock. Compact/camera-only presentation closes editing without changing saved geometry.

## Automatic connection

The first device with a valid browser-readable schema connects immediately: no countdown, saved-device priority or duplicate probe. Discovery publishes the result before connection cancels other probes. Successful connections are kept in the session's found list, not written to saved-device history. Manual rescans can find additional devices without replacing a live connection.

Discovery validates the comma's CORS-readable service schema, not just an open HTTP port. At most three current private /24 subnets are scanned, using addresses exposed through ICE candidates, SDP and local-candidate statistics. Hostname resolution runs concurrently and never gates IP scanning. Browsers can hide all interface addresses; if the hostname also fails, use manual IP entry rather than guessing past networks.

Historical device records remain untouched for compatibility, but dev no longer reads them during discovery or lists them. The scan report records current subnets, hidden-address status and counts of timeout, network, HTTP and schema failures. A generic network failure cannot prove CORS versus routing because browsers intentionally mask that distinction. No layouts, permissions or offline files are cleared.

Cancel, starting demo, manual connection, editing a layout or hiding the page cancels startup scanning. An unsuccessful attempt does not spin in an automatic retry loop. Loading the installed app without internet still attempts local discovery: lack of internet does not imply lack of LAN. No data or permission settings are cleared.

Dev reports a live session only after camera playback plus parsed `carState` and `modelV2` messages arrive; a clock-sync reply alone is insufficient. If either core service stops for over five seconds, a quiet “Telemetry delayed” warning flags potentially outdated values. Delivery clears the warning automatically; it does not trigger reconnects. Foreground return has a five-second grace period. Incomplete telemetry buffering is limited to 1,048,576 characters; exceeding it discards damaged data and records a warning without clearing settings.

A playable camera closes the device menu/dialog immediately; “Waiting for data…” remains until core telemetry is ready. If startup times out with camera playback and an opened data channel but missing telemetry, dev automatically retries the same IP after two seconds, at most three times. Each attempt keeps its normal 20-second stream-readiness deadline. Other initial failures remain actionable rather than looping. Cancellation stops recovery; exhausted retries show a compact message and leave full detail in Logs/QR.

Double-tap a non-interactive area of the viewer to **toggle** fullscreen while on-road telemetry and a playing WebRTC video are active, or in demo. Double-tap can also exit fullscreen after a stream stops. Buttons, links, inputs, dialogs, side docks, dragging and layout editing are excluded. The second tap toggles fullscreen directly, preserving the browser's user-gesture requirement. The fullscreen button shares the same toggle handler. Native Android video PiP stays camera-only.

Camera handoffs wait for startup/any current negotiation to finish and use the latest Experimental mode and speed, retaining the 10/15 m/s hysteresis. Logs name each handoff and camera track; a delayed startup adds a one-time packet/decode/readiness snapshot after five seconds. Cancellation cannot mark a superseded session connected. These changes do not require clearing site data or modifying the comma.

An established stream gets five seconds to recover from a temporary WebRTC disconnection without replacing its peer. Terminal failures and longer interruptions use the existing three-retry limit. Recovery hides the connection panel/dialog; the panel opens automatically only when recovery fails. Link diagnostics record peer/ICE/channel state and browser online/hidden status. The QR payload retains the latest warning/error plus recent progress, so successful recovery does not erase the useful failure evidence.

**Full log QR** offers an optional, frozen snapshot of all stored events (up to 100) in numbered QR pages, each no larger than 1,200 UTF-8 bytes. Scan every page from the same snapshot. Decoded JSON uses `opwebview-log-chunk-v1`: group by `id`, sort by `part`, then concatenate `text` to reconstruct the exact full log. Reopening Logs refreshes the snapshot; Copy/Download remain the quickest full-log transfer when available. Nothing is uploaded automatically.

The camera video is a non-interactive presentation layer; pointer gestures reach the viewer instead of the browser's native video menu. Selection/callouts are disabled on the viewer before the gesture starts, and its context-menu handler runs in capture phase. Buttons, fields and side panels retain their own touch and scrolling behavior.

Browser permission prompts, actual local device reachability and Android fullscreen require a parked hardware test. Unit tests exercise delay/priority/cancellation/permission fallback and gesture boundaries; browser smoke testing does not connect to or change a comma.

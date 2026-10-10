# OPView visual and resize pass

Reference: [`gerrylum/opview`, `layouts`, commit 8b1b2ab](https://github.com/gerrylum/opview/tree/8b1b2abbe2ef85b22f69a4eabdd187dba2ca02c1).
The pinned Enhanced, Detailed, top-row, HUD, camera-transform and model-renderer source was inspected. The upstream Classic headunit golden was also inspected. This is a source-based browser port, not a claim of pixel-identical Flutter rendering.

## Preset fidelity

- Classic: height/1080 scaling, stock MAX box, centred speed/unit, top road name, nearby metric/imperial speed-limit sign and upper-right clock/mode.
- Enhanced: min(width/536, height/240) scaling, 20-unit edge anchoring, 74×52 speed pill, 84×40 side pills, circular driver/confidence indicators, 100-unit steering/lead readouts, curved torque bar and projected lead reticle/distance tag.
- Detailed: the shared Enhanced HUD plus clock/device grid, folding steering/driver/longitudinal/lead panels, lateral-acceleration and acceleration histories (ten seconds), and bottom status chips. Side columns shrink together to fit short screens.
- Text uses Roboto when available (including Android), with Arial fallback. Camera video and projected overlays share calibration, crop, zoom and horizon offset.
- Custom layouts remain percentage-based and locally saved. Recalling a preset uses current source geometry; viewport changes do not modify saved custom arrangements.

## Window and lifecycle behavior

- Normal page: full chosen layout. Fullscreen, orientation, visual-viewport resize and foreground return refresh widget geometry and canvas resolution.
- Width below 480 px or height below 240 px: temporary speed + torque presentation, with the expensive road overlay disabled.
- Width below 220 px or height below 140 px: camera only.
- Standard video Picture-in-Picture: camera only. This browser surface does not include DOM widgets or the overlay canvas. No canvas-stream re-encoding or unsupported Android Document PiP dependency is introduced.
- Background: stop dashboard/overlay painting, keep telemetry state and the original video track. Foreground/PiP exit restores the current full layout and latest render; attempt to resume video if paused.
- Critical/full alerts stay prominent. This is a supplemental viewer, not a replacement for the comma's safety-critical display. Browsers/Android can suspend background execution or network traffic; uninterrupted background telemetry is not guaranteed.

## Verification

Browser demo screenshots reviewed at 1280×480, 1024×768, 844×390 and 360×200. The compact view contained only speed/torque, and enlarging restored Detailed with both graphs and correct canvas dimensions. Visible numeric rows and trace legends had no horizontal overflow at headunit size. Folding/expanding a panel was exercised. Browser console had no errors.

The pass caught and fixed internal scrolling of the clipped camera container after control focus/resizing (`overflow: clip`). Fullscreen was exercised in the embedded preview, but that environment does not provide an authoritative Android fullscreen/PiP test. Automated transition tests additionally cover fullscreen events, orientation/resize, background suspension, video PiP entry/exit, zero-size protection, camera/overlay alignment, custom-layout preservation, bounded telemetry histories and graph semantics.

On-device follow-up, while parked: open each preset, enter fullscreen, press Home to check camera-only PiP, return, rotate once and confirm the original full layout/graphs are restored. Test browser and installed PWA separately. No device-side patch changes are required for these viewer UI changes.

# Chestnut widgets (dev)

Long-press to edit, then enable **Chestnut GPU**, **Chestnut power / link**, or **Chestnut power graph** in Widgets. Drag/resize and save them in a custom view. All three start hidden, so Classic/Enhanced/Detailed and saved layouts keep their existing appearance. Demo supplies clearly simulated readings for previewing them.

- GPU: hotspot/memory temperature, utilization, clock and fan RPM.
- Power/link: GPU draw/limit, supply voltage/current, fault flag and raw PCIe state (`0x78` is the upstream link-up check).
- Graph: GPU socket power, not total vehicle/comma power. A dashed trace shows its power limit. History is memory-only, up to 60 seconds/61 points at 1 Hz, with breaks across invalid/missing data.

The existing `chestnutState` service is an optional WebRTC subscription. Unsupported forks skip it; no comma patch or extra network service is required. Millivolts/milliamps are converted to volts/amps. Envelope validity and ordering are retained; resets/device changes clear old readings/history. More than three seconds without a message marks readings stale. Missing/invalid/stale readings show dashes, never cached live-looking numbers. A zero-filled inactive GPU struct shows **GPU N/A**, while available supply/link fields can still be displayed.

Panels paint at most 1 Hz. A slow freshness timer runs only for visible Chestnut panels with received data, pauses in background/native video PiP, and does not redraw the model overlay. GPU metrics can be cached upstream for roughly ten seconds despite a 10 Hz service; the graph does not imply faster physical measurements. Connected hardware is not proof that the big model is active. This implementation does not infer that status from temperatures/power.

Source-verified against rx-wb-stg `7dd9234` on 2026-10-19: [schema](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/cereal/log.capnp), [monitoring](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/hardware/chestnut/monitoring.py), [GPU publisher](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/selfdrive/modeld/modeld.py). Physical-device confirmation is still required while parked.

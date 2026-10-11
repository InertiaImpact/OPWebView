# rx-wb-stg compatibility and indicator smoothing

Compared on 2026-10-11 against gerrylum/openpilot `rx-wb-stg` commit `7dd9234ae5e879684104cd6c24497b9c925fe69a` and gerrylum/opview `layouts` commit `8b1b2abbe2ef85b22f69a4eabdd187dba2ca02c1`.

The browser understands the retained slim payload fields, including `carOutput.actuatorsOutput.torque` and `modelV2.meta.disengagePredictions`. There is no necessary subscription or protocol change. The service rates (20 Hz moving values, 10 Hz control/monitoring, 1–5 Hz slow services) fit the existing data handling; modelV2 is not thinned. This is source/fixture verification, not a connection to a physical comma.

DEV now adds a presentation-only 0.1-second torque filter, as on the comma, and short interpolation of the already-filtered confidence value. These two SVGs animate up to 30 fps independently of the lower-rate text/graph paints. Animation pauses in the background/native video PiP, does not integrate time spent hidden, and stops at a settled value. Raw telemetry and trace history remain unchanged. Nonzero torque at the stream's minimum resolution (0.001) is no longer discarded by the drawing threshold.

## Remaining upstream precision limitation

`opview_slim.py` rounds **all** floats to three decimal places, including `controlsState.curvature` and `desiredCurvature`. For example, at 25 m/s, a desired curvature of 0.0004 represents 0.25 m/s² lateral acceleration (about 8.3% on the default 3 m/s² scale), but becomes 0.000 on the wire. The next 0.001 step represents about 20.8% of that scale. That can erase gentle angle/curvature steering effort and make both the web and native OPView estimate step abruptly. Smoothing cannot restore missing precision; DEV does not invent a nonzero value.

Recommended upstream improvement: retain at least six decimal places specifically for curvature fields while keeping the other bandwidth savings. For closer agreement with the comma's own display, expose the vehicle's max lateral acceleration and road roll (or the display's calculated steering-effort value); native OPView and the web currently estimate `desiredCurvature * vEgo² / 3`, whereas the comma includes road-roll compensation and vehicle-specific scaling.

The comma confidence display and OPView confidence widget also differ visually: comma uses vertical dot position and engagement-dependent colors; OPView uses the ring and variable-radius ball. DEV retains the requested OPView appearance, not a replacement comma display.

## Parked test

Reopen DEV online while disconnected to install `2026.10.11-auto-connect.1-dev`, which includes these indicator changes. Compare Enhanced/Detailed torque and confidence responsiveness with the prior stable version. Record whether steering mode is TORQUE or ANGLE and include the diagnostic build when reporting a mismatch. Test fullscreen/background return separately; the native floating window remains camera-only. Never interact with the viewer while driving.

Sources: [slim telemetry](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/opview_slim.py), [model payload](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/system/webrtc/webrtcd.py), [comma torque renderer](https://github.com/gerrylum/openpilot/blob/7dd9234ae5e879684104cd6c24497b9c925fe69a/openpilot/selfdrive/ui/mici/onroad/torque_bar.py), [OPView state](https://github.com/gerrylum/opview/blob/8b1b2abbe2ef85b22f69a4eabdd187dba2ca02c1/lib/selfdrive/ui/ui_state.dart).

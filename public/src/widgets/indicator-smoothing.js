import { torqueBarValue } from "../core/state.js?v=5";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Presentation only: never alter telemetry, control readouts or graph samples.
// Torque uses the comma's 0.1 s time constant. Confidence is already filtered
// on modelV2 arrival; a short interpolation filter bridges widget repaint gaps.
export class IndicatorSmoother {
  constructor() {
    this.state = null;
    this.lastTime = null;
    this.torque = 0;
    this.confidence = 1;
  }

  pause() { this.lastTime = null; }

  sample(state, now) {
    if (this.state !== state) {
      this.state = state;
      this.lastTime = null;
      this.torque = 0;
      this.confidence = clamp(state.confidenceFiltered ?? 1, 0, 1);
    }
    const dt = this.lastTime === null ? 0 : clamp((now - this.lastTime) / 1000, 0, .1);
    this.lastTime = now;
    const torque = torqueBarValue(state) || 0;
    const confidence = clamp(state.confidenceFiltered ?? 1, 0, 1);
    this.torque += (1 - Math.exp(-dt / .1)) * (torque - this.torque);
    this.confidence += (1 - Math.exp(-dt / .05)) * (confidence - this.confidence);
    const pending = Math.abs(torque - this.torque) > .000001 || Math.abs(confidence - this.confidence) > .0001;
    if (!pending) { this.torque = torque; this.confidence = confidence; }
    return { torqueDisplayValue: this.torque, confidenceFiltered: this.confidence, pending };
  }
}

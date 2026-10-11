// Count once per live on-road session, not once per telemetry update.
export class DevWatermark {
  constructor(element, {
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (id) => clearTimeout(id)
  } = {}) {
    this.element = element;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.live = false;
    this.timer = null;
  }

  update({ connected, onRoad, demo, hasStream, ready }) {
    const live = Boolean(connected && onRoad && !demo && hasStream && ready);
    if (!this.element || live === this.live) return;
    this.live = live;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.element.classList.remove("dev-watermark-faded");
    if (live) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.element.classList.add("dev-watermark-faded");
      }, 10_000);
    }
  }
}

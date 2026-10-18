// One bounded snapshot, not a second WebRTC session or an animation loop.
export class CameraTransition {
  constructor({ root, video, overlay, canvas, label }) {
    Object.assign(this, { root, video, overlay, canvas, label });
    this.active = false;
  }

  start() {
    this.clear();
    const { width, height } = this.video.getBoundingClientRect();
    if (!width || !height || this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return false;
    const scale = Math.min(1, 1280 / width, 720 / height);
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = this.canvas.getContext("2d");
      const zoom = Math.max(this.canvas.width / this.video.videoWidth, this.canvas.height / this.video.videoHeight);
      const w = this.video.videoWidth * zoom, h = this.video.videoHeight * zoom;
      context.drawImage(this.video, (this.canvas.width - w) / 2, (this.canvas.height - h) / 2, w, h);
      context.drawImage(this.overlay, 0, 0, this.canvas.width, this.canvas.height);
    } catch {
      this.clear();
      return false;
    }
    this.active = true;
    this.canvas.hidden = this.label.hidden = false;
    this.root.classList.add("camera-switching");
    return true;
  }

  finish() {
    if (!this.active) return;
    this.root.classList.remove("camera-switching");
    this.root.classList.add("camera-handoff-fading");
    this.label.hidden = true;
    this.canvas.classList.add("camera-snapshot-fade");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), 180);
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = null;
    this.active = false;
    this.canvas.hidden = this.label.hidden = true;
    this.canvas.classList.remove("camera-snapshot-fade");
    this.root.classList.remove("camera-switching", "camera-handoff-fading");
    // Release the snapshot on success, failure, or explicit disconnect.
    this.canvas.width = this.canvas.height = 1;
  }
}

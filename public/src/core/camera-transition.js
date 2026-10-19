// One video-only snapshot below the live overlay, not a second WebRTC session.
export class CameraTransition {
  constructor({ root, video, overlay, canvas, label, renderer }) {
    Object.assign(this, { root, video, overlay, canvas, label, renderer });
    this.active = false;
  }

  start() {
    this.clear();
    // The state may select the new camera before its video arrives. Continue
    // projecting telemetry into the camera that is still visible meanwhile.
    this.renderer.holdCamera();
    const viewport = this.overlay.getBoundingClientRect();
    const { width, height } = viewport;
    if (!width || !height || this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return false;
    const scale = Math.min(1, 1280 / width, 720 / height);
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = this.canvas.getContext("2d");
      const rect = this.video.getBoundingClientRect();
      const zoom = Math.max(rect.width / this.video.videoWidth, rect.height / this.video.videoHeight);
      const w = this.video.videoWidth * zoom, h = this.video.videoHeight * zoom;
      const sx = this.canvas.width / width, sy = this.canvas.height / height;
      context.drawImage(this.video,
        (rect.left - viewport.left + (rect.width - w) / 2) * sx,
        (rect.top - viewport.top + (rect.height - h) / 2) * sy, w * sx, h * sy);
    } catch {
      // Even if a browser refuses capture, hold projection until replacement
      // video arrives. No stale overlay is baked into the snapshot.
      this.canvas.width = this.canvas.height = 1;
      return false;
    }
    this.active = true;
    this.canvas.hidden = this.label.hidden = false;
    this.root.classList.add("camera-switching");
    return true;
  }

  finish() {
    this.renderer.releaseCamera();
    if (!this.active) return;
    this.root.classList.remove("camera-switching");
    this.root.classList.add("camera-handoff-fading");
    this.label.hidden = true;
    this.canvas.classList.add("camera-snapshot-fade");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), 180);
  }

  clear() {
    this.renderer.releaseCamera();
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

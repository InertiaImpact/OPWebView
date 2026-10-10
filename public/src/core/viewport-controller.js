export function presentationMode(width, height, videoPip = false) {
  if (videoPip || width < 220 || height < 140) return "camera";
  if (width < 480 || height < 240) return "compact";
  return "full";
}

// Video PiP contains the video pixels, not this page's canvas or HTML. Keep it
// camera-only and leave the original WebRTC track attached across transitions.
export class ViewportController {
  constructor({ app, video, renderer, widgets, onChange = () => {}, windowRef = window, documentRef = document }) {
    Object.assign(this, { app, video, renderer, widgets, onChange, windowRef, documentRef });
    this.videoPip = false;
    this.mode = null;
    this.listeners = [];
    const listen = (target, name, callback) => {
      target?.addEventListener(name, callback);
      this.listeners.push(() => target?.removeEventListener(name, callback));
    };
    this.schedule = () => {
      if (this.pending) return;
      this.pending = windowRef.requestAnimationFrame(() => { this.pending = null; this.refresh(); });
    };
    for (const name of ["resize", "orientationchange", "pageshow"]) listen(windowRef, name, this.schedule);
    listen(windowRef.visualViewport, "resize", this.schedule);
    listen(documentRef, "fullscreenchange", this.schedule);
    listen(documentRef, "visibilitychange", () => {
      // requestAnimationFrame can stop in the background: suspend immediately.
      this.refresh();
      if (!documentRef.hidden) {
        this.schedule();
        if (video.srcObject && video.paused) video.play().catch(() => {});
      }
    });
    listen(video, "enterpictureinpicture", () => { this.videoPip = true; this.refresh(); });
    listen(video, "leavepictureinpicture", () => { this.videoPip = false; this.refresh(); this.schedule(); });
    this.observer = new windowRef.ResizeObserver(this.schedule);
    this.observer.observe(app);
    this.refresh();
  }

  refresh() {
    const { width, height } = this.app.getBoundingClientRect();
    if (!width || !height) return; // Don't replace a valid layout with zero-size geometry.
    const mode = presentationMode(width, height, this.videoPip);
    const suspended = Boolean(this.documentRef.hidden);
    this.app.dataset.presentation = mode;
    this.app.dataset.background = String(suspended);
    this.widgets.setDisplayMode(mode, suspended);
    this.renderer.setPresentation(mode, suspended);
    this.renderer.resize();
    if (this.mode !== mode) this.onChange({ mode, width: Math.round(width), height: Math.round(height) });
    this.mode = mode;
  }

  destroy() {
    this.listeners.forEach((remove) => remove());
    this.observer.disconnect();
    if (this.pending) this.windowRef.cancelAnimationFrame(this.pending);
  }
}

import {
  HEIGHT_INIT,
  calculateFrameMatrix,
  lineToPolygon,
  pathLengthIndex,
  projectPoint
} from "./projection.js";

const MIN_DRAW_DISTANCE = 10;
const MAX_DRAW_DISTANCE = 100;
const CLIP_MARGIN = 500;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const leadPresent = (lead) => Boolean(lead && (lead.status === true || lead.present === true));

export class OverlayRenderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.store = store;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    store.addEventListener("frame", () => this.render());
    store.addEventListener("change", () => this.render());
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.render();
  }

  clear() {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render() {
    this.clear();
    if (!this.width || !this.height) return;
    const state = this.store.state;
    if (!state.pathX.length) return;

    const context = this.context;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.save();
    const inset = Math.max(10, Math.min(this.width, this.height) * 0.016);
    const content = { left: inset, top: inset, right: this.width - inset, bottom: this.height - inset };
    const clip = {
      left: content.left - CLIP_MARGIN,
      top: content.top - CLIP_MARGIN,
      right: content.right + CLIP_MARGIN,
      bottom: content.bottom + CLIP_MARGIN
    };

    context.beginPath();
    context.rect(content.left, content.top, content.right - content.left, content.bottom - content.top);
    context.clip();

    const matrix = calculateFrameMatrix(state, this.width, this.height);
    const pathEnd = state.pathX.at(-1) ?? MIN_DRAW_DISTANCE;
    let maxDistance = clamp(pathEnd, MIN_DRAW_DISTANCE, MAX_DRAW_DISTANCE);
    const laneMaxIndex = pathLengthIndex(state.laneLineX[0], maxDistance);

    for (let index = 0; index < 4; index += 1) {
      const probability = clamp(state.laneLineProbs[index] ?? 0, 0, 1);
      const polygon = lineToPolygon(matrix, state.laneLineX[index], state.laneLineY[index], state.laneLineZ[index], {
        yOffset: 0.025 * probability,
        maxIndex: laneMaxIndex,
        maxDistance,
        clip
      });
      this.drawPolygon(polygon, `rgba(255,255,255,${clamp(probability, 0, 0.7)})`);
    }

    for (let index = 0; index < 2; index += 1) {
      const polygon = lineToPolygon(matrix, state.roadEdgeX[index], state.roadEdgeY[index], state.roadEdgeZ[index], {
        yOffset: 0.025,
        maxIndex: laneMaxIndex,
        maxDistance,
        clip
      });
      this.drawPolygon(polygon, `rgba(255,40,45,${clamp(1 - (state.roadEdgeStds[index] ?? 0), 0, 1)})`);
    }

    if (leadPresent(state.leadOne)) {
      const leadDistance = Number(state.leadOne.dRel) * 2;
      maxDistance = clamp(leadDistance - Math.min(leadDistance * 0.35, 10), 0, maxDistance);
    }
    const pathMaxIndex = pathLengthIndex(state.pathX, maxDistance);
    const pathHeight = state.calibHeight[0] ?? HEIGHT_INIT;
    const path = lineToPolygon(matrix, state.pathX, state.pathY, state.pathZ, {
      yOffset: 0.9,
      zOffset: pathHeight,
      maxIndex: pathMaxIndex,
      maxDistance,
      allowInvert: false,
      clip
    });
    this.drawPath(path, state);
    this.drawLeads(matrix, clip, content, pathHeight, state);
    context.restore();
  }

  drawPolygon(points, fillStyle) {
    if (points.length < 3) return;
    const context = this.context;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
    context.closePath();
    context.fillStyle = fillStyle;
    context.fill();
  }

  drawPath(points, state) {
    if (points.length < 3) return;
    let minimumY = Infinity;
    let maximumY = -Infinity;
    for (const point of points) {
      minimumY = Math.min(minimumY, point.y);
      maximumY = Math.max(maximumY, point.y);
    }
    const context = this.context;
    const gradient = context.createLinearGradient(0, maximumY, 0, minimumY);
    if (state.experimentalMode) {
      const average = state.accelerationX.length
        ? state.accelerationX.reduce((total, value) => total + value, 0) / state.accelerationX.length
        : 0;
      const hue = clamp(60 + average * 35, 0, 120);
      gradient.addColorStop(0, `hsla(${hue}, 88%, 60%, .62)`);
      gradient.addColorStop(0.56, `hsla(${hue}, 78%, 66%, .28)`);
      gradient.addColorStop(1, `hsla(${hue}, 70%, 72%, 0)`);
    } else if (state.allowThrottle) {
      gradient.addColorStop(0, "rgba(13,248,122,.55)");
      gradient.addColorStop(0.5, "rgba(114,255,92,.35)");
      gradient.addColorStop(1, "rgba(114,255,92,0)");
    } else {
      gradient.addColorStop(0, "rgba(242,242,242,.48)");
      gradient.addColorStop(0.5, "rgba(242,242,242,.3)");
      gradient.addColorStop(1, "rgba(242,242,242,0)");
    }
    this.drawPolygon(points, gradient);
  }

  drawLeads(matrix, clip, content, pathHeight, state) {
    for (const lead of [state.leadOne, state.leadTwo]) {
      if (!leadPresent(lead)) continue;
      const dRel = Number(lead.dRel) || 0;
      const vRel = Number(lead.vRel) || 0;
      const yRel = Number(lead.yRel) || 0;
      const index = pathLengthIndex(state.pathX, dRel);
      const z = state.pathZ[index] ?? 0;
      const point = projectPoint(matrix, [dRel, -yRel, z + pathHeight], clip);
      if (!point) continue;

      const size = clamp((25 * 30) / (dRel / 3 + 30), 15, 30) * 2.35;
      const x = clamp(point.x, content.left, content.right - size / 2);
      const y = Math.min(point.y, content.bottom - size * 0.6);
      const glow = [
        { x: x + size * 1.35 + size / 5, y: y + size + size / 10 },
        { x, y: y - size / 10 },
        { x: x - size * 1.35 - size / 5, y: y + size + size / 10 }
      ];
      const chevron = [
        { x: x + size * 1.25, y: y + size },
        { x, y },
        { x: x - size * 1.25, y: y + size }
      ];
      let alpha = dRel < 40 ? 1 - dRel / 40 : 0;
      if (vRel < 0) alpha += -vRel / 10;
      this.drawPolygon(glow, "rgba(218,202,37,.95)");
      this.drawPolygon(chevron, `rgba(201,34,49,${clamp(alpha, 0.15, 1)})`);
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
  }
}

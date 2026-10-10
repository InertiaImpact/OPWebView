import { WIDGETS } from "./widget-catalog.js";

const item = (x, y, w, h) => ({ x, y, w, h, hidden: false });

const visible = {
  classic: {
    cruise: item(1, 1, 10, 16),
    speed: item(42, 0, 16, 21),
    speedLimit: item(89, 1, 10, 16),
    roadName: item(36, 22, 28, 9),
    clock: item(85, 20, 14, 8),
    turnSignals: item(32, 39, 36, 13),
    mode: item(2, 78, 14, 14)
  },
  enhanced: {
    cruise: item(25, 1, 16, 15),
    speed: item(42, 1, 16, 18),
    speedLimit: item(59, 1, 16, 15),
    roadName: item(38, 20, 24, 9),
    driver: item(2, 2, 9, 18),
    confidence: item(12, 2, 9, 18),
    clock: item(84, 2, 14, 8),
    steering: item(2, 61, 18, 34),
    lead: item(80, 61, 18, 34),
    torque: item(35, 84, 30, 11)
  },
  detailed: {
    cruise: item(25, 1, 16, 15),
    speed: item(42, 1, 16, 18),
    speedLimit: item(59, 1, 16, 15),
    roadName: item(38, 20, 24, 9),
    driver: item(2, 2, 9, 18),
    confidence: item(12, 2, 9, 18),
    deviceHealth: item(82, 2, 16, 24),
    detailedSteering: item(2, 27, 19, 52),
    detailedDriver: item(2, 81, 19, 17),
    detailedLongitudinal: item(79, 28, 19, 39),
    detailedLead: item(79, 69, 19, 29),
    status: item(25, 88, 50, 9)
  }
};

export const BUILT_IN_LAYOUTS = Object.freeze({
  classic: Object.freeze({ name: "Classic", description: "Original openpilot HUD with centered speed and MAX box." }),
  enhanced: Object.freeze({ name: "Enhanced", description: "gerrylum’s compact pills, driver confidence, steering, lead, and torque." }),
  detailed: Object.freeze({ name: "Detailed", description: "Full steering, driver, longitudinal, lead, and device diagnostics." })
});

export function createPresetLayout(id) {
  const chosen = visible[id] || visible.classic;
  return Object.fromEntries(WIDGETS.map((widget) => [
    widget.id,
    chosen[widget.id] ? { ...chosen[widget.id] } : { x: 40, y: 40, w: 20, h: 20, hidden: true }
  ]));
}

export function normalizeLayout(candidate, fallback = "classic") {
  const result = createPresetLayout(fallback);
  if (!candidate || typeof candidate !== "object") return result;
  for (const widget of WIDGETS) {
    const saved = candidate[widget.id];
    if (!saved || typeof saved !== "object") continue;
    result[widget.id] = {
      x: finite(saved.x, result[widget.id].x),
      y: finite(saved.y, result[widget.id].y),
      w: finite(saved.w, result[widget.id].w),
      h: finite(saved.h, result[widget.id].h),
      hidden: Boolean(saved.hidden)
    };
  }
  return result;
}

export function sanitizeLayoutName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

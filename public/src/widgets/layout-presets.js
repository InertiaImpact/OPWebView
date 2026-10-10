import { WIDGETS } from "./widget-catalog.js";

const item = (x, y, w, h) => ({ x, y, w, h, hidden: false });

const visible = {
  classic: {
    cruise: item(2, 6, 10, 19),
    speed: item(42, 6, 16, 22),
    speedLimit: item(14, 6, 10, 23),
    roadName: item(30, 2, 40, 6),
    clock: item(73, 6, 14, 8),
    turnSignals: item(32, 39, 36, 13),
    mode: item(88, 5, 9, 18)
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
    clock: item(82, 2, 16, 6),
    detailedSteering: item(2, 27, 19, 52),
    detailedDriver: item(2, 81, 19, 17),
    detailedLongitudinal: item(79, 28, 19, 39),
    detailedLead: item(79, 69, 19, 29),
    status: item(25, 94, 50, 4),
    torque: item(35, 84, 30, 11)
  }
};

export const BUILT_IN_LAYOUTS = Object.freeze({
  classic: Object.freeze({ name: "Classic", description: "Original openpilot HUD with centered speed and MAX box." }),
  enhanced: Object.freeze({ name: "Enhanced", description: "gerrylum’s compact pills, driver confidence, steering, lead, and torque." }),
  detailed: Object.freeze({ name: "Detailed", description: "Full steering, driver, longitudinal, lead, and device diagnostics." })
});

// Source: gerrylum/opview layouts @ 8b1b2ab. Enhanced/Detailed use
// min(w/536,h/240); anchoring corners must not stretch on a 4:3 tablet.
export function presetGeometry(id, width, height, isMetric = true, collapsed = new Set()) {
  const result = createPresetLayout(id);
  const u = Math.min(width / 536, height / 240);
  const set = (name, x, y, w, h) => {
    result[name] = item(x / width * 100, y / height * 100, w / width * 100, h / height * 100);
  };
  if (id === "classic") {
    const s = height / 1080, b = 30 * s;
    const cruiseW = (isMetric ? 200 : 172) * s;
    set("cruise", b + (isMetric ? 46 : 60) * s, b + 45 * s, cruiseW, 204 * s);
    set("speed", width / 2 - 160 * s, b + 62 * s, 320 * s, 238 * s);
    set("speedLimit", b + (60 + (isMetric ? 200 : 172) + 24) * s, b + 39 * s, cruiseW, 260 * s);
    set("roadName", width * .25, b - 4 * s, width * .5, 60 * s);
    set("clock", width - b - 552 * s, b + 45 * s, 300 * s, 70 * s);
    set("mode", width - b - 224 * s, b + 45 * s, 192 * s, 192 * s);
    set("turnSignals", width * .32, height * .4, width * .36, height * .13);
    return { layout: result, unit: s, border: b };
  }
  const edge = 20 * u;
  set("speed", width / 2 - 37 * u, edge, 74 * u, 52 * u);
  set("cruise", width / 2 - 129 * u, edge, 84 * u, 40 * u);
  set("speedLimit", width / 2 + 45 * u, edge, 84 * u, 40 * u);
  set("roadName", width * .3, edge + 58 * u, width * .4, 24 * u);
  set("driver", edge, edge, 48.6 * u, 48.6 * u);
  set("confidence", edge + 54.6 * u, edge, 48.6 * u, 48.6 * u);
  set("torque", width / 2 - 96 * u, height - 54 * u, 192 * u, 54 * u);
  if (id === "enhanced") {
    set("clock", width - edge - 60 * u, edge, 60 * u, 16 * u);
    set("steering", edge, height - edge - 68 * u, 100 * u, 68 * u);
    set("lead", width - edge - 100 * u, height - edge - 68 * u, 100 * u, 68 * u);
  } else {
    set("clock", width - edge - 82 * u, edge, 82 * u, 13 * u);
    set("deviceHealth", width - edge - 82 * u, edge + 15 * u, 82 * u, 34 * u);
    // The source FittedBox fits each complete column when vertical space is short.
    const panelTop = 86 * u, available = height - edge - panelTop;
    const steerH = collapsed.has("detailedSteering") ? 15 : 115;
    const driverH = collapsed.has("detailedDriver") ? 15 : 46;
    const longH = collapsed.has("detailedLongitudinal") ? 15 : 97;
    const leadH = collapsed.has("detailedLead") ? 15 : 73;
    const leftScale = Math.min(1, available / ((steerH + driverH + 4) * u));
    const rightScale = Math.min(1, available / ((longH + leadH + 4) * u));
    set("detailedSteering", edge, panelTop, 112 * u * leftScale, steerH * u * leftScale);
    set("detailedDriver", edge, panelTop + (steerH + 4) * u * leftScale, 112 * u * leftScale, driverH * u * leftScale);
    set("detailedLongitudinal", width - edge - 112 * u * rightScale, panelTop, 112 * u * rightScale, longH * u * rightScale);
    set("detailedLead", width - edge - 112 * u * rightScale, panelTop + (longH + 4) * u * rightScale, 112 * u * rightScale, leadH * u * rightScale);
    set("status", edge + 120 * u, height - 14 * u, width - 2 * (edge + 120 * u), 8 * u);
  }
  return { layout: result, unit: u, border: 4 * u };
}

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

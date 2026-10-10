import {
  activeLead,
  displaySpeed,
  isCruiseSet,
  setSpeed,
  speedConversion,
  speedLimitToShow,
  steeringMode,
  torqueBarValue
} from "../core/state.js?v=2";

const dash = "–";
const noLead = "– –";
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);
const number = (value, digits = 0) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : dash;
const angle = (value) => `${Math.abs(Number(value)) < 0.05 ? "0.0" : Number(value).toFixed(1)}°`;
const speedUnit = (state) => state.isMetric ? "km/h" : "mph";
const row = (label, value, tone = "") => `<div class="data-row"><span>${label}</span><strong class="${tone}">${value}</strong></div>`;
const panel = (title, rows, badge = "") => `<header><span>${title}</span>${badge ? `<em>${badge}</em>` : ""}</header><div class="data-rows">${rows.join("")}</div>`;

function driveLabel(state) {
  return ({ engaged: "Engaged", override: "Override", latOnly: "Steering", longOnly: "Cruise" })[state.status] || "Standby";
}

function leadValues(state) {
  const lead = state.status === "disengaged" ? null : activeLead(state);
  if (!lead) return null;
  const distance = Number(lead.dRel) || 0;
  const relative = Number(lead.vRel) || 0;
  const conversion = speedConversion(state);
  return {
    distance,
    relative,
    gap: state.vEgo > 0.5 ? `${(distance / state.vEgo).toFixed(1)} s` : dash,
    relativeText: `${relative * conversion > 0 ? "+" : ""}${Math.round(relative * conversion)} ${speedUnit(state)}`,
    leadSpeed: `${Math.max(0, Math.round((state.vEgo + relative) * conversion))} ${speedUnit(state)}`,
    impact: relative < -0.1 ? `${(distance / -relative).toFixed(1)} s` : dash
  };
}

function gear(value) {
  return ({ drive: "D", reverse: "R", neutral: "N", park: "P" })[value] || (value ? String(value).toUpperCase() : dash);
}

export const WIDGETS = Object.freeze([
  {
    id: "speed", title: "Current speed", className: "classic-speed minimal",
    render: (state) => `<strong class="speed-number">${Math.round(displaySpeed(state))}</strong><span class="speed-unit">${speedUnit(state)}</span>`
  },
  {
    id: "cruise", title: "Set speed", className: "stock-cruise",
    render: (state) => `<span class="max-label">MAX</span><strong>${isCruiseSet(state) ? Math.round(setSpeed(state)) : dash}</strong>`
  },
  {
    id: "speedLimit", title: "Speed limit", className: "speed-limit-sign",
    render(state) {
      const limit = speedLimitToShow(state);
      const next = state.speedLimitAheadValid && state.speedLimitAhead > 0
        ? `<small>next ${Math.round(state.speedLimitAhead * speedConversion(state))} · ${formatDistance(state.speedLimitAheadDistance, state.isMetric)}</small>` : "";
      return `<strong>${limit === null ? noLead : Math.round(limit * speedConversion(state))}</strong><span>LIMIT</span>${next}`;
    }
  },
  {
    id: "roadName", title: "Road name", className: "road-name-pill",
    render: (state) => `<strong>${safe(state.roadName || "Road name unavailable")}</strong>`
  },
  {
    id: "clock", title: "Clock", className: "clock-pill",
    render: () => `<strong>${new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date())}</strong>`
  },
  {
    id: "driver", title: "Driver monitoring", className: "driver-disc",
    render: (state) => `<div class="driver-cone ${state.dmAwarenessPercent < 95 ? "warn" : ""}" style="--rotation:${state.dmRotationDeg}deg"></div><div class="driver-head ${state.dmFaceDetected ? "seen" : ""}"></div><span>${state.dmSeen ? `${Math.round(state.dmAwarenessPercent)}%` : noLead}</span>`
  },
  {
    id: "confidence", title: "Model confidence", className: "confidence-disc",
    render: (state) => `<div class="confidence-dot" style="--confidence:${Math.max(0, Math.min(1, state.confidenceFiltered))}"></div><span>${state.confidenceSeen ? `${Math.round(state.confidenceFiltered * 100)}%` : noLead}</span>`
  },
  {
    id: "steering", title: "Steering", className: "info-stack",
    render(state) {
      const mode = steeringMode(state);
      return [
        row("STEER", mode ? mode.toUpperCase() : "OFF", mode || "dim"),
        row("TARGET", state.latActive ? angle(state.targetSteeringAngleDeg) : dash),
        row("ACTUAL", angle(state.steeringAngleDeg))
      ].join("");
    }
  },
  {
    id: "lead", title: "Lead vehicle", className: "info-stack",
    render(state) {
      const lead = leadValues(state);
      return [
        row("GAP", lead?.gap ?? noLead),
        row("REL", lead?.relativeText ?? noLead),
        row("LEAD", lead?.leadSpeed ?? noLead)
      ].join("");
    }
  },
  {
    id: "torque", title: "Steering torque", className: "torque-meter",
    render(state) {
      const value = torqueBarValue(state);
      return `<span>TORQUE</span><div class="torque-track"><i style="--torque:${value}"></i></div><strong>${Math.round(value * 100)}%</strong>`;
    }
  },
  {
    id: "deviceHealth", title: "Device health", className: "health-grid",
    render: (state) => [
      row("CPU", state.deviceSeen ? `${Math.round(state.cpuTempC)}°C` : dash),
      row("MEM", state.deviceSeen ? `${state.memoryUsagePercent}%` : dash),
      row("DISK", state.deviceSeen ? `${Math.round(100 - state.freeSpacePercent)}%` : dash),
      row("WI-FI", state.deviceSeen ? safe(state.networkStrength) : dash),
      row("POWER", state.deviceSeen ? `${number(state.powerDrawW, 1)} W` : dash),
      row("CALIB", state.calStatus === "calibrated" ? "100%" : state.calPerc ? `${state.calPerc}%` : dash)
    ].join("")
  },
  {
    id: "detailedSteering", title: "Detailed steering", className: "detail-panel",
    render(state) {
      const mode = steeringMode(state);
      const lateralWant = state.desiredCurvature * state.vEgo * state.vEgo;
      const lateralGot = state.curvature * state.vEgo * state.vEgo;
      return panel("STEERING", [
        row("Mode", mode ? mode.toUpperCase() : "OFF", mode || "dim"),
        row("Target", state.latActive ? angle(state.targetSteeringAngleDeg) : dash),
        row("Actual", angle(state.steeringAngleDeg)),
        row("Rate", `${number(state.steeringRateDeg, 1)}°/s`),
        row("Torque cmd", state.latActive ? `${Math.round(state.torqueOutput * 100)}%` : dash),
        row("Driver torque", number(state.steeringTorque, 1)),
        row("Lat accel", state.latActive ? `${number(lateralWant, 2)} / ${number(lateralGot, 2)}` : dash)
      ], state.lateralSaturated ? "SATURATED" : "NOT SATURATED");
    }
  },
  {
    id: "detailedDriver", title: "Detailed driver", className: "detail-panel",
    render: (state) => panel("DRIVER", [
      row("Face", state.dmSeen ? state.dmFaceDetected ? "detected" : "not seen" : dash, state.dmFaceDetected ? "good" : "warn"),
      row("Attention", state.dmSeen ? `${Math.round(state.dmAwarenessPercent)}%` : dash, state.dmAwarenessPercent < 95 ? "warn" : "good"),
      row("Policy", safe(state.dmPolicy || dash))
    ])
  },
  {
    id: "detailedLongitudinal", title: "Detailed longitudinal", className: "detail-panel",
    render(state) {
      const pedals = [state.gasPressed ? "throttle" : "", state.brakePressed ? "brake" : ""].filter(Boolean).join(" + ") || "— / —";
      return panel("LONGITUDINAL", [
        row("ACC", state.cruiseEnabled ? "on" : "off", state.cruiseEnabled ? "good" : "dim"),
        row("Personality", safe(state.personality ? state.personality[0].toUpperCase() + state.personality.slice(1) : dash)),
        row("Accel cmd", state.longActive ? `${number(state.accelCommand, 2)} m/s²` : dash),
        row("Accel actual", `${number(state.aEgo, 2)} m/s²`),
        row("Throttle / brake", pedals, pedals === "— / —" ? "dim" : "warn")
      ], state.experimentalMode ? "EXPERIMENTAL" : "CHILL");
    }
  },
  {
    id: "detailedLead", title: "Detailed lead", className: "detail-panel",
    render(state) {
      const lead = leadValues(state);
      const second = state.leadTwo && (state.leadTwo.present || state.leadTwo.status)
        ? formatLeadDistance(Number(state.leadTwo.dRel) || 0, state.isMetric) : dash;
      return panel("LEAD", [
        row("Distance", lead ? formatLeadDistance(lead.distance, state.isMetric) : noLead),
        row("Gap", lead?.gap ?? noLead),
        row("Closing", lead?.relativeText ?? noLead),
        row("Lead speed", lead?.leadSpeed ?? noLead),
        row("Time to impact", lead?.impact ?? noLead),
        row("Second lead", lead ? second : noLead)
      ], lead ? (state.leadOne?.radar ? "RADAR + VISION" : "VISION") : "");
    }
  },
  {
    id: "status", title: "Vehicle status", className: "status-strip",
    render: (state) => `<span>${gear(state.gearShifter)}</span>${state.leftBlinker ? "<span>◀ signal</span>" : ""}${state.rightBlinker ? "<span>signal ▶</span>" : ""}<span>lanes ${number(state.laneLineProbs[1], 2)} · ${number(state.laneLineProbs[2], 2)}</span><span>curv ${number(state.curvature, 4)}</span>`
  },
  {
    id: "mode", title: "Driving mode", className: "mode-pill",
    render: (state) => `<strong>${state.experimentalMode ? "EXPERIMENTAL" : "CHILL"}</strong><span>${driveLabel(state)}</span>`
  },
  {
    id: "turnSignals", title: "Turn signals", className: "turn-signals minimal",
    render: (state) => `<span class="${state.leftBlinker ? "active" : ""}">◀</span><span class="${state.rightBlinker ? "active" : ""}">▶</span>`
  },
  {
    id: "drive", title: "Drive state", className: "basic-card",
    render: (state) => `<span class="widget-kicker">Openpilot</span><strong class="widget-value small">${driveLabel(state)}</strong><span class="widget-detail">${state.streamType === "wideRoad" ? "Wide road camera" : "Road camera"}</span>`
  },
  {
    id: "device", title: "Device data", className: "basic-card",
    render: (state) => `<span class="widget-kicker">Device</span><strong class="widget-value small">${safe(state.deviceType || "Awaiting data")}</strong><span class="widget-detail">${safe(state.sensor || "Camera sensor unknown")}</span>`
  }
]);

export function formatDistance(metres, isMetric) {
  if (isMetric) return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 50) * 50} m`;
  const miles = metres / 1609.344;
  return miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${Math.round(metres * 3.28084 / 50) * 50} ft`;
}

export function formatLeadDistance(metres, isMetric) {
  return isMetric ? `${Math.round(metres)} m` : `${Math.round(metres * 3.28084)} ft`;
}

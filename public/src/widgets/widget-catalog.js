import {
  activeLead,
  displaySpeed,
  isCruiseSet,
  leadWarningColor,
  setSpeed,
  speedConversion,
  speedLimitToShow,
  steeringMode,
  torqueBarValue
} from "../core/state.js?v=3";
import { torqueGraph, traceGraph } from "./widget-graphs.js";

const dash = "–";
const noLead = "– –";
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);
const number = (value, digits = 0) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : dash;
const angle = (value) => `${Math.abs(Number(value)) < 0.05 ? "0.0" : Number(value).toFixed(1)}°`;
const speedUnit = (state) => state.isMetric ? "km/h" : "mph";
const row = (label, value, tone = "") => `<div class="data-row"><span>${label}</span><strong ${tone.startsWith('rgb(') ? `style="color:${tone}"` : `class="${tone}"`}>${value}</strong></div>`;
const panel = (title, rows, badge = "", footer = "") => `<header><button type="button" class="panel-toggle" aria-label="Fold ${title.toLowerCase()} panel" aria-expanded="true">${title}<span aria-hidden="true"> ▾</span></button>${badge ? `<em class="${badge === 'SATURATED' || badge === 'EXPERIMENTAL' ? 'warn' : title === 'LEAD' ? 'angle' : badge === 'CHILL' ? 'dim' : 'good'}">${badge}</em>` : ""}</header><div class="data-rows">${rows.join("")}</div>${footer}`;
const leadTone = (lead) => lead ? leadWarningColor(lead.distance, lead.relative) : "dim";
const networkBars = (value) => ({ poor: 1, moderate: 2, good: 3, great: 4 })[value] || 0;

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
    impact: relative < -0.1 && distance / -relative < 99 ? `${(distance / -relative).toFixed(1)} s` : dash
  };
}

function gear(value) {
  return ({ drive: "D", reverse: "R", neutral: "N", park: "P" })[value] || (value ? String(value).toUpperCase() : dash);
}

export const WIDGETS = Object.freeze([
  {
    id: "speed", title: "Current speed", className: "classic-speed",
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
        ? `<small>next ${Math.round(state.speedLimitAhead * speedConversion(state))} in ${formatDistance(state.speedLimitAheadDistance, state.isMetric)}</small>` : "";
      return `<div class="limit-main"><span class="classic-limit-label">SPEED<br>LIMIT</span><strong>${limit === null ? noLead : Math.round(limit * speedConversion(state))}</strong><span class="limit-label">LIMIT</span></div>${next}`;
    }
  },
  {
    id: "roadName", title: "Road name", className: "road-name-pill",
    render: (state) => `<strong>${safe(state.roadName || "")}</strong>`
  },
  {
    id: "clock", title: "Clock", className: "clock-pill",
    render: () => `<strong>${new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date())}</strong>`
  },
  {
    id: "driver", title: "Driver monitoring", className: "driver-disc",
    render(state) {
      const live = state.status !== "disengaged" && state.dmActive;
      return `<svg viewBox="0 0 100 100" class="driver-symbol ${live ? "live" : "inactive"}" role="img" aria-label="Driver attention ${state.dmSeen ? Math.round(state.dmAwarenessPercent) + ' percent' : 'unavailable'}">${live ? `<path d="M18,23 A42,42 0 0 1 82,23" transform="rotate(${state.dmRotationDeg - 90} 50 50)" fill="none" stroke="${state.dmAwarenessPercent < 95 ? '#ff7300' : '#00ff40'}" stroke-width="8" stroke-linecap="round"/>` : ""}<circle cx="50" cy="42" r="12" fill="white"/><path d="M27,70 Q27,54 50,54 Q73,54 73,70 Z" fill="white"/></svg>`;
    }
  },
  {
    id: "confidence", title: "Model confidence", className: "confidence-disc",
    render(state) {
      const live = state.status !== "disengaged" && state.confidenceSeen;
      const c = Math.max(0, Math.min(1, state.confidenceFiltered));
      const colors = c > .5 ? ["#00ffcc", "#00ff26"] : c > .2 ? ["#ffc800", "#ff7300"] : ["#ff0015", "#ff0059"];
      return `<svg viewBox="0 0 100 100" class="driver-symbol ${live ? '' : 'inactive'}" role="img" aria-label="Model confidence ${live ? Math.round(c * 100) + ' percent' : 'unavailable'}"><defs><linearGradient id="confidence-gradient" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><circle cx="50" cy="50" r="40" fill="none" stroke="#ffffff2e" stroke-width="4.5"/>${live ? `<circle cx="50" cy="50" r="${8 + 26 * c}" fill="url(#confidence-gradient)"/>` : ""}</svg>`;
    }
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
        row("GAP", lead?.gap ?? noLead, leadTone(lead)),
        row("REL", lead?.relativeText ?? noLead),
        row("LEAD", lead?.leadSpeed ?? noLead)
      ].join("");
    }
  },
  {
    id: "torque", title: "Steering torque", className: "torque-meter",
    render(state) {
      const value = torqueBarValue(state);
      return torqueGraph(value, state.status);
    }
  },
  {
    id: "deviceHealth", title: "Device health", className: "health-grid",
    render: (state) => [
      row("CPU", state.deviceSeen ? `${Math.round(state.cpuTempC)}°C` : dash),
      row("MEM", state.deviceSeen ? `${state.memoryUsagePercent}%` : dash),
      row("DISK", state.deviceSeen ? `${Math.round(100 - state.freeSpacePercent)}%` : dash),
      row("Wi-Fi", state.deviceSeen ? `<span class="network-bars" aria-label="${safe(state.networkStrength)} signal">${[0,1,2,3].map((i) => `<i class="${i < networkBars(state.networkStrength) ? 'lit' : ''}" style="height:${35 + i * 20}%"></i>`).join('')}</span>` : dash),
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
      ], state.latActive ? state.lateralSaturated ? "SATURATED" : "NOT SATURATED" : "", traceGraph(state.history, { label: "lat accel", want: "want", got: "got", color: "#3adb6d", lo: -2, hi: 2 }));
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
      ], state.experimentalMode ? "EXPERIMENTAL" : "CHILL", traceGraph(state.history, { label: "accel", want: "cmd", got: "actual", color: "#ff9a3c", lo: -2, hi: 1.5 }));
    }
  },
  {
    id: "detailedLead", title: "Detailed lead", className: "detail-panel",
    render(state) {
      const lead = leadValues(state);
      const second = state.leadTwo && (state.leadTwo.present || state.leadTwo.status) && Math.abs(Number(state.leadTwo.dRel) - (lead?.distance || 0)) > 3
        ? formatLeadDistance(Number(state.leadTwo.dRel) || 0, state.isMetric) : dash;
      return panel("LEAD", [
        row("Distance", lead ? formatLeadDistance(lead.distance, state.isMetric) : noLead, leadTone(lead)),
        row("Gap", lead?.gap ?? noLead, leadTone(lead)),
        row("Closing", lead?.relativeText ?? noLead),
        row("Lead speed", lead?.leadSpeed ?? noLead),
        row("Time to impact", lead?.impact ?? noLead),
        row("Second lead", lead ? second : noLead)
      ], lead ? (state.leadOne?.radar ? "RADAR + VISION" : "VISION") : "");
    }
  },
  {
    id: "status", title: "Vehicle status", className: "status-strip",
    render: (state) => `<span>${gear(state.gearShifter)}</span>${state.leftBlinker && state.rightBlinker ? '<span class="warn">◀ hazards ▶</span>' : state.leftBlinker ? '<span class="warn">◀ signal</span>' : state.rightBlinker ? '<span class="warn">signal ▶</span>' : ''}${state.leftBlindspot || state.rightBlindspot ? `<span class="warn">BSM ${state.leftBlindspot ? 'L' : ''} ${state.rightBlindspot ? 'R' : ''}</span>` : ''}<span>lanes L ${number(state.laneLineProbs[1], 2)} · R ${number(state.laneLineProbs[2], 2)}</span><span>curv ${number(state.curvature, 4)}</span>`
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

export const SPEED = Object.freeze({
  metersPerSecondToKph: 3.6,
  metersPerSecondToMph: 2.23694,
  kilometersToMiles: 0.621371,
  setSpeedUnavailable: 255
});

export function createInitialState() {
  return {
    version: 0,
    status: "disengaged",
    started: false,
    isConnected: false,
    isMetric: true,
    streamType: "road",
    isSwitchingStream: false,
    vEgo: 0,
    vEgoCluster: 0,
    vCruiseCluster: 0,
    vCruiseDeprecated: 0,
    vEgoClusterSeen: false,
    aEgo: 0,
    steeringAngleDeg: 0,
    steeringRateDeg: 0,
    steeringTorque: 0,
    gasPressed: false,
    brakePressed: false,
    gearShifter: "",
    cruiseEnabled: false,
    enabled: false,
    engageable: false,
    experimentalMode: false,
    alertText1: "",
    alertText2: "",
    alertSize: 0,
    alertStatus: 0,
    openpilotState: "",
    personality: "",
    curvature: 0,
    desiredCurvature: 0,
    lateralControlKind: "",
    lateralSaturated: false,
    torqueOutput: 0,
    latActive: false,
    longActive: false,
    accelCommand: 0,
    targetSteeringAngleDeg: 0,
    lateralMode: null,
    dmSeen: false,
    dmActive: false,
    dmFaceDetected: false,
    dmAwarenessPercent: 100,
    dmRotationDeg: 90,
    dmPolicy: "",
    confidenceSeen: false,
    brakeDisengageProb: 0,
    steerOverrideProb: 0,
    confidenceFiltered: 1,
    pathX: [],
    pathY: [],
    pathZ: [],
    laneLineX: [[], [], [], []],
    laneLineY: [[], [], [], []],
    laneLineZ: [[], [], [], []],
    laneLineProbs: [0, 0, 0, 0],
    roadEdgeX: [[], []],
    roadEdgeY: [[], []],
    roadEdgeZ: [[], []],
    roadEdgeStds: [0, 0],
    accelerationX: [],
    rpyCalib: [],
    wideFromDeviceEuler: [],
    calStatus: "",
    calPerc: 0,
    calibHeight: [],
    leadOne: null,
    leadTwo: null,
    allowThrottle: true,
    deviceType: "",
    deviceSeen: false,
    cpuTempC: 0,
    memoryUsagePercent: 0,
    freeSpacePercent: 100,
    networkStrength: "unknown",
    powerDrawW: 0,
    sensor: "",
    paramsSeen: false,
    speedLimitMode: 0,
    roadNameToggle: false,
    forceTorqueSteer: false,
    trueVEgoUI: false,
    liveSpeedCorrection: false,
    cruiseSpeedOffsetKph: 0,
    showTurnSignals: false,
    showBlindSpot: false,
    madsSeen: false,
    madsState: "disabled",
    madsEnabled: false,
    madsAvailable: false,
    overrideLongitudinal: false,
    leftBlinker: false,
    rightBlinker: false,
    leftBlindspot: false,
    rightBlindspot: false,
    speedLimit: 0,
    speedLimitLast: 0,
    speedLimitOffset: 0,
    speedLimitValid: false,
    speedLimitLastValid: false,
    speedLimitFinalLast: 0,
    speedLimitSource: "none",
    speedLimitAssistState: "disabled",
    speedLimitSeen: false,
    speedLimitAheadValid: false,
    speedLimitAhead: 0,
    speedLimitAheadDistance: 0,
    roadName: "",
    brand: "",
    carFlags: 0
  };
}

export class TelemetryStore extends EventTarget {
  constructor(initial = createInitialState()) {
    super();
    this.state = initial;
  }

  update(mutator, { render = false } = {}) {
    mutator(this.state);
    this.state.version += 1;
    this.dispatchEvent(new CustomEvent(render ? "frame" : "change", { detail: this.state }));
    if (render) this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
  }

  setConnection(isConnected) {
    if (this.state.isConnected === isConnected) return;
    this.update((state) => { state.isConnected = isConnected; });
  }

  resetTelemetry() {
    const next = createInitialState();
    next.isMetric = this.state.isMetric;
    next.streamType = this.state.streamType;
    this.state = next;
    this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
    this.dispatchEvent(new CustomEvent("frame", { detail: this.state }));
  }
}

const asNumbers = (value) => Array.isArray(value)
  ? value.map((item) => Number.isFinite(Number(item)) ? Number(item) : 0)
  : [];

const fixedNumbers = (value, length) => {
  const items = asNumbers(value).slice(0, length);
  while (items.length < length) items.push(0);
  return items;
};

const nested = (value, key) => value && typeof value === "object" ? value[key] : undefined;

function alertSize(value) {
  if (Number.isInteger(value)) return value;
  return ({ none: 0, small: 1, mid: 2, full: 3 })[value] ?? 0;
}

function alertStatus(value) {
  if (Number.isInteger(value)) return value;
  return ({ normal: 0, userPrompt: 1, critical: 2 })[value] ?? 0;
}

export function applyTelemetry(store, type, data) {
  if (!data || typeof data !== "object") return false;

  switch (type) {
    case "carState":
      store.update((state) => {
        state.vEgo = Number(data.vEgo) || 0;
        state.vEgoCluster = Number(data.vEgoCluster) || 0;
        state.vCruiseCluster = Number(data.vCruiseCluster) || 0;
        if (state.vEgoCluster !== 0) state.vEgoClusterSeen = true;
        state.aEgo = Number(data.aEgo) || 0;
        state.steeringAngleDeg = Number(data.steeringAngleDeg) || 0;
        state.steeringRateDeg = Number(data.steeringRateDeg) || 0;
        state.steeringTorque = Number(data.steeringTorque) || 0;
        state.gasPressed = Boolean(data.gasPressed);
        state.brakePressed = Boolean(data.brakePressed);
        state.gearShifter = String(data.gearShifter ?? "");
        state.cruiseEnabled = Boolean(data.cruiseState?.enabled);
        state.leftBlinker = Boolean(data.leftBlinker);
        state.rightBlinker = Boolean(data.rightBlinker);
        state.leftBlindspot = Boolean(data.leftBlindspot);
        state.rightBlindspot = Boolean(data.rightBlindspot);
      });
      return true;
    case "selfdriveState":
      store.update((state) => {
        state.enabled = Boolean(data.enabled);
        state.engageable = Boolean(data.engageable);
        state.experimentalMode = Boolean(data.experimentalMode);
        state.alertText1 = String(data.alertText1 ?? "");
        state.alertText2 = String(data.alertText2 ?? "");
        state.alertSize = alertSize(data.alertSize);
        state.alertStatus = alertStatus(data.alertStatus);
        state.openpilotState = String(data.state ?? "");
        state.personality = String(data.personality ?? "");
        state.started = true;
        updateDriveStatus(state);
      });
      return true;
    case "controlsState":
      store.update((state) => {
        state.vCruiseDeprecated = Number(data.vCruiseDEPRECATED) || 0;
        state.curvature = Number(data.curvature) || 0;
        state.desiredCurvature = Number(data.desiredCurvature) || 0;
        const lateral = data.lateralControlState;
        state.lateralControlKind = lateral && typeof lateral === "object" ? Object.keys(lateral)[0] || "" : "";
        state.lateralSaturated = Boolean(lateral?.[state.lateralControlKind]?.saturated);
      });
      return true;
    case "modelV2":
      store.update((state) => {
        state.pathX = asNumbers(nested(data.position, "x"));
        state.pathY = asNumbers(nested(data.position, "y"));
        state.pathZ = asNumbers(nested(data.position, "z"));
        const lanes = Array.isArray(data.laneLines) ? data.laneLines : [];
        for (let index = 0; index < 4; index += 1) {
          state.laneLineX[index] = asNumbers(lanes[index]?.x);
          state.laneLineY[index] = asNumbers(lanes[index]?.y);
          state.laneLineZ[index] = asNumbers(lanes[index]?.z);
        }
        state.laneLineProbs = fixedNumbers(data.laneLineProbs, 4);
        const edges = Array.isArray(data.roadEdges) ? data.roadEdges : [];
        for (let index = 0; index < 2; index += 1) {
          state.roadEdgeX[index] = asNumbers(edges[index]?.x);
          state.roadEdgeY[index] = asNumbers(edges[index]?.y);
          state.roadEdgeZ[index] = asNumbers(edges[index]?.z);
        }
        state.roadEdgeStds = fixedNumbers(data.roadEdgeStds, 2);
        state.accelerationX = asNumbers(nested(data.acceleration, "x"));
        const predictions = data.meta?.disengagePredictions;
        if (predictions && typeof predictions === "object") {
          state.confidenceSeen = true;
          state.brakeDisengageProb = largest(predictions.brakeDisengageProbs);
          state.steerOverrideProb = largest(predictions.steerOverrideProbs);
          state.confidenceFiltered += 0.09 * (confidenceTarget(state) - state.confidenceFiltered);
        }
      }, { render: true });
      return true;
    case "liveCalibration":
    case "extrinsicsCalibration":
      store.update((state) => {
        state.rpyCalib = asNumbers(data.rpyCalib);
        state.wideFromDeviceEuler = asNumbers(data.wideFromDeviceEuler);
        state.calStatus = String(data.calStatus ?? "");
        state.calPerc = Number(data.calPerc) || state.calPerc;
        state.calibHeight = asNumbers(data.height);
      });
      return true;
    case "radarState":
      store.update((state) => {
        state.leadOne = data.leadOne ?? null;
        state.leadTwo = data.leadTwo ?? null;
      });
      return true;
    case "longitudinalPlan":
      store.update((state) => { state.allowThrottle = data.allowThrottle ?? true; });
      return true;
    case "deviceState":
      store.update((state) => {
        state.deviceType = String(data.deviceType ?? "");
        state.started = data.started ?? state.started;
        state.deviceSeen = true;
        const temperatures = asNumbers(data.cpuTempC);
        state.cpuTempC = temperatures.length ? Math.max(...temperatures) : state.cpuTempC;
        state.memoryUsagePercent = Number(data.memoryUsagePercent) || 0;
        state.freeSpacePercent = Number(data.freeSpacePercent ?? 100);
        state.networkStrength = String(data.networkStrength ?? "unknown");
        state.powerDrawW = Number(data.powerDrawW) || 0;
      });
      return true;
    case "roadCameraState":
    case "narrowRoadCameraState":
      store.update((state) => { state.sensor = String(data.sensor ?? ""); });
      return true;
    case "opviewParams":
      store.update((state) => {
        state.paramsSeen = true;
        state.isMetric = data.IsMetric ?? state.isMetric;
        state.speedLimitMode = Number(data.SpeedLimitMode) || 0;
        state.roadNameToggle = Boolean(data.RoadNameToggle);
        state.forceTorqueSteer = Boolean(data.RivianForceTorqueSteer);
        state.trueVEgoUI = Boolean(data.TrueVEgoUI);
        state.liveSpeedCorrection = Boolean(data.SPLiveSpeedCorrectionEnabled);
        state.cruiseSpeedOffsetKph = Number(data.SPCruiseSpeedOffset) || 0;
        state.showTurnSignals = Boolean(data.ShowTurnSignals);
        state.showBlindSpot = Boolean(data.BlindSpot);
        state.brand = String(data.CarBrand ?? state.brand);
        state.carFlags = Number(data.CarFlags) || state.carFlags;
      });
      return true;
    case "longitudinalPlanSP":
      store.update((state) => {
        const resolver = data.speedLimit?.resolver || {};
        const assist = data.speedLimit?.assist || {};
        state.speedLimit = Number(resolver.speedLimit) || 0;
        state.speedLimitLast = Number(resolver.speedLimitLast) || 0;
        state.speedLimitOffset = Number(resolver.speedLimitOffset) || 0;
        state.speedLimitValid = Boolean(resolver.speedLimitValid);
        state.speedLimitLastValid = Boolean(resolver.speedLimitLastValid);
        state.speedLimitFinalLast = Number(resolver.speedLimitFinalLast) || 0;
        state.speedLimitSource = String(resolver.source ?? "none");
        state.speedLimitAssistState = String(assist.state ?? "disabled");
        if ((state.speedLimitValid && state.speedLimit > 0) || (state.speedLimitLastValid && state.speedLimitLast > 0)) state.speedLimitSeen = true;
      });
      return true;
    case "liveMapDataSP":
      store.update((state) => {
        state.speedLimitAheadValid = Boolean(data.speedLimitAheadValid);
        state.speedLimitAhead = Number(data.speedLimitAhead) || 0;
        state.speedLimitAheadDistance = Number(data.speedLimitAheadDistance) || 0;
        state.roadName = String(data.roadName ?? "");
      });
      return true;
    case "carControl":
      store.update((state) => {
        state.latActive = Boolean(data.latActive);
        state.longActive = Boolean(data.longActive);
        state.accelCommand = Number(data.actuators?.accel) || 0;
        state.targetSteeringAngleDeg = Number(data.actuators?.steeringAngleDeg) || 0;
      });
      return true;
    case "carOutput":
      store.update((state) => {
        state.torqueOutput = Number(data.actuatorsOutput?.torque) || 0;
        const torqueCan = Number(data.actuatorsOutput?.torqueOutputCan) || 0;
        if (state.latActive && state.brand === "rivian" && (state.carFlags & 2)) {
          state.lateralMode = state.forceTorqueSteer || torqueCan !== 0 ? "torque" : "angle";
        }
      });
      return true;
    case "selfdriveStateSP":
      store.update((state) => {
        const mads = data.mads || {};
        state.madsSeen = true;
        state.madsState = String(mads.state ?? "disabled");
        state.madsEnabled = Boolean(mads.enabled);
        state.madsAvailable = Boolean(mads.available);
        updateDriveStatus(state);
      });
      return true;
    case "onroadEvents":
      store.update((state) => {
        state.overrideLongitudinal = Array.isArray(data) && data.some((event) => event?.overrideLongitudinal === true);
        updateDriveStatus(state);
      });
      return true;
    case "driverMonitoringState":
      store.update((state) => applyDriverMonitoring(state, data));
      return true;
    default:
      return false;
  }
}

export function displaySpeed(state) {
  let raw;
  if (state.vEgoClusterSeen && !state.trueVEgoUI) raw = state.vEgoCluster;
  else if (state.liveSpeedCorrection) raw = state.vEgo - state.cruiseSpeedOffsetKph / SPEED.metersPerSecondToKph;
  else raw = state.vEgo;
  return Math.max(0, raw * (state.isMetric ? SPEED.metersPerSecondToKph : SPEED.metersPerSecondToMph));
}

export function speedConversion(state) {
  return state.isMetric ? SPEED.metersPerSecondToKph : SPEED.metersPerSecondToMph;
}

export function activeLead(state) {
  const lead = state.leadOne;
  return lead && (lead.status === true || lead.present === true) ? lead : null;
}

export function steeringMode(state) {
  if (!state.latActive) return null;
  if (state.lateralMode) return state.lateralMode;
  if (state.lateralControlKind === "angleState") return "angle";
  if (state.lateralControlKind === "torqueState") return "torque";
  return null;
}

export function torqueBarValue(state) {
  if (["angleState", "curvatureState"].includes(state.lateralControlKind)) {
    return state.latActive ? clamp(state.desiredCurvature * state.vEgo * state.vEgo / 3, -1, 1) : 0;
  }
  return clamp(-state.torqueOutput, -1, 1);
}

export function speedLimitToShow(state) {
  if (state.speedLimitValid && state.speedLimit > 0) return state.speedLimit;
  if (state.speedLimitLastValid && state.speedLimitLast > 0) return state.speedLimitLast;
  return null;
}

function updateDriveStatus(state) {
  const override = ["preEnabled", "overriding"].includes(state.openpilotState);
  if (!state.madsSeen) {
    state.status = override ? "override" : state.enabled ? "engaged" : "disengaged";
  } else if (state.openpilotState === "preEnabled" || state.madsState === "paused" || state.madsState === "overriding") {
    state.status = "override";
  } else if (!state.madsAvailable) {
    state.status = state.enabled ? "engaged" : "disengaged";
  } else if (state.madsEnabled && state.enabled) {
    state.status = "engaged";
  } else if (state.madsEnabled) {
    state.status = "latOnly";
  } else if (state.enabled) {
    state.status = "longOnly";
  } else {
    state.status = "disengaged";
  }
}

function applyDriverMonitoring(state, data) {
  state.dmSeen = true;
  const vision = data.visionPolicyState;
  if (vision && typeof vision === "object") {
    state.dmActive = data.activePolicy === "vision";
    state.dmPolicy = String(data.activePolicy ?? "");
    state.dmFaceDetected = Boolean(vision.faceDetected);
    state.dmAwarenessPercent = Number(vision.awarenessPercent ?? 100);
    const pitch = (Number(vision.pose?.pitch) || 0) + 6 * Math.PI / 180;
    const yaw = (Number(vision.pose?.yaw) || 0) * (data.isRHD ? 1 : -1);
    const target = Math.atan2(pitch * 2, yaw) * 180 / Math.PI;
    const difference = ((target - state.dmRotationDeg + 540) % 360) - 180;
    state.dmRotationDeg += 0.35 * difference;
  } else {
    state.dmActive = data.isActiveMode ?? true;
    state.dmFaceDetected = Boolean(data.faceDetected);
    state.dmAwarenessPercent = Number(data.awarenessStatus ?? 1) * 100;
  }
}

function confidenceTarget(state) {
  if (state.status === "latOnly") return 1 - state.steerOverrideProb;
  if (state.status === "longOnly") return 1 - state.brakeDisengageProb;
  return (1 - state.brakeDisengageProb) * (1 - state.steerOverrideProb);
}

function largest(values) {
  return Array.isArray(values) ? Math.max(0, ...values.map((value) => Number(value) || 0)) : 0;
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function rawSetSpeed(state) {
  return state.vCruiseCluster !== 0 ? state.vCruiseCluster : state.vCruiseDeprecated;
}

export function isCruiseSet(state) {
  const speed = rawSetSpeed(state);
  return speed > 0 && speed < SPEED.setSpeedUnavailable;
}

export function setSpeed(state) {
  const speed = rawSetSpeed(state);
  if (!isCruiseSet(state)) return speed;
  return state.isMetric ? speed : speed * SPEED.kilometersToMiles;
}

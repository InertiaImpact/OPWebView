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
    enabled: false,
    experimentalMode: false,
    alertText1: "",
    alertText2: "",
    alertSize: 0,
    alertStatus: 0,
    openpilotState: "",
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
    calibHeight: [],
    leadOne: null,
    leadTwo: null,
    allowThrottle: true,
    deviceType: "",
    sensor: ""
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
      });
      return true;
    case "selfdriveState":
      store.update((state) => {
        state.enabled = Boolean(data.enabled);
        state.experimentalMode = Boolean(data.experimentalMode);
        state.alertText1 = String(data.alertText1 ?? "");
        state.alertText2 = String(data.alertText2 ?? "");
        state.alertSize = alertSize(data.alertSize);
        state.alertStatus = alertStatus(data.alertStatus);
        state.openpilotState = String(data.state ?? "");
        state.started = true;
        state.status = ["preEnabled", "overriding"].includes(state.openpilotState)
          ? "override"
          : state.enabled ? "engaged" : "disengaged";
      });
      return true;
    case "controlsState":
      store.update((state) => { state.vCruiseDeprecated = Number(data.vCruiseDEPRECATED) || 0; });
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
      }, { render: true });
      return true;
    case "liveCalibration":
    case "extrinsicsCalibration":
      store.update((state) => {
        state.rpyCalib = asNumbers(data.rpyCalib);
        state.wideFromDeviceEuler = asNumbers(data.wideFromDeviceEuler);
        state.calStatus = String(data.calStatus ?? "");
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
      });
      return true;
    case "roadCameraState":
    case "narrowRoadCameraState":
      store.update((state) => { state.sensor = String(data.sensor ?? ""); });
      return true;
    default:
      return false;
  }
}

export function displaySpeed(state) {
  const raw = state.vEgoClusterSeen ? state.vEgoCluster : state.vEgo;
  return Math.max(0, raw * (state.isMetric ? SPEED.metersPerSecondToKph : SPEED.metersPerSecondToMph));
}

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

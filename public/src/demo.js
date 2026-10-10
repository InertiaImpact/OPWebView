export class DemoFeed {
  constructor(adapter) {
    this.adapter = adapter;
    this.timer = null;
    this.startedAt = 0;
  }

  start() {
    if (this.timer) return;
    this.startedAt = performance.now();
    this.tick();
    this.timer = setInterval(() => this.tick(), 80);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const speed = 22 + Math.sin(elapsed * 0.45) * 4;
    const points = 33;
    const x = Array.from({ length: points }, (_, index) => index * 4);
    const curve = (offset) => x.map((distance) => offset + Math.sin(distance / 32 + elapsed * 0.08) * (distance / 150));
    const zero = x.map(() => 0);
    const lanes = [-5.4, -1.8, 1.8, 5.4].map((offset) => ({ x, y: curve(offset), z: zero }));
    const edges = [-7.4, 7.4].map((offset) => ({ x, y: curve(offset), z: zero }));
    const messages = [
      { type: "deviceState", data: { deviceType: "mici", started: true, cpuTempC: [54, 58, 61, 57], memoryUsagePercent: 46, freeSpacePercent: 72, networkStrength: "great", powerDrawW: 6.2 } },
      { type: "roadCameraState", data: { sensor: "ox03c10" } },
      { type: "liveCalibration", data: { rpyCalib: [0, 0.018, 0], wideFromDeviceEuler: [0, 0, 0], calStatus: "calibrated", calPerc: 100, height: [1.22] } },
      { type: "carState", data: { vEgo: speed, vEgoCluster: speed, vCruiseCluster: 105, aEgo: Math.sin(elapsed) * 0.2, steeringAngleDeg: Math.sin(elapsed * 0.7) * 8, steeringRateDeg: Math.cos(elapsed * 0.7) * 4, steeringTorque: Math.sin(elapsed) * 0.6, gearShifter: "drive", cruiseState: { enabled: true }, leftBlinker: false, rightBlinker: false } },
      { type: "selfdriveState", data: { enabled: true, engageable: true, experimentalMode: false, state: "enabled", personality: "standard", alertSize: "none", alertStatus: "normal" } },
      { type: "controlsState", data: { curvature: 0.0018, desiredCurvature: 0.002, lateralControlState: { torqueState: { saturated: false } } } },
      { type: "radarState", data: { leadOne: { status: true, radar: true, dRel: 38 + Math.sin(elapsed) * 5, yRel: 0.1, vRel: -0.8 }, leadTwo: { status: false } } },
      { type: "longitudinalPlan", data: { allowThrottle: Math.sin(elapsed * 0.3) > -0.55 } },
      { type: "opviewParams", data: { IsMetric: true, SpeedLimitMode: 1, RoadNameToggle: true, ShowTurnSignals: true, BlindSpot: true, CarBrand: "rivian", CarFlags: 2 } },
      { type: "longitudinalPlanSP", data: { speedLimit: { resolver: { speedLimit: 27.78, speedLimitLast: 27.78, speedLimitValid: true, speedLimitLastValid: true, speedLimitFinalLast: 27.78, source: "map" }, assist: { state: "active" } } } },
      { type: "liveMapDataSP", data: { speedLimitAheadValid: true, speedLimitAhead: 22.22, speedLimitAheadDistance: 640, roadName: "Cam Fella Boulevard" } },
      { type: "carControl", data: { latActive: true, longActive: true, actuators: { accel: 0.2, steeringAngleDeg: Math.sin(elapsed * 0.7) * 8.5 } } },
      { type: "carOutput", data: { actuatorsOutput: { torque: Math.sin(elapsed * 0.7) * 0.35, torqueOutputCan: 0.2 } } },
      { type: "driverMonitoringState", data: { activePolicy: "vision", isRHD: false, visionPolicyState: { faceDetected: true, awarenessPercent: 98, pose: { pitch: 0, yaw: Math.sin(elapsed * 0.2) * 0.05 } } } },
      { type: "modelV2", data: { position: { x, y: curve(0), z: zero }, laneLines: lanes, laneLineProbs: [0.35, 0.95, 0.95, 0.35], roadEdges: edges, roadEdgeStds: [0.15, 0.25], acceleration: { x: x.map((_, index) => Math.sin(elapsed + index / 7) * 0.35) }, meta: { disengagePredictions: { brakeDisengageProbs: [.04], steerOverrideProbs: [.02] } } } }
    ];
    this.adapter.apply(messages.map((message) => JSON.stringify(message)).join(""));
  }
}

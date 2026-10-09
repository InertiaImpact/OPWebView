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
      { type: "deviceState", data: { deviceType: "mici", started: true } },
      { type: "roadCameraState", data: { sensor: "ox03c10" } },
      { type: "liveCalibration", data: { rpyCalib: [0, 0.018, 0], wideFromDeviceEuler: [0, 0, 0], calStatus: "calibrated", height: [1.22] } },
      { type: "carState", data: { vEgo: speed, vEgoCluster: speed, vCruiseCluster: 105 } },
      { type: "selfdriveState", data: { enabled: true, experimentalMode: false, state: "enabled", alertSize: "none", alertStatus: "normal" } },
      { type: "radarState", data: { leadOne: { status: true, dRel: 38 + Math.sin(elapsed) * 5, yRel: 0.1, vRel: -0.8 }, leadTwo: { status: false } } },
      { type: "longitudinalPlan", data: { allowThrottle: Math.sin(elapsed * 0.3) > -0.55 } },
      { type: "modelV2", data: { position: { x, y: curve(0), z: zero }, laneLines: lanes, laneLineProbs: [0.35, 0.95, 0.95, 0.35], roadEdges: edges, roadEdgeStds: [0.15, 0.25], acceleration: { x: x.map((_, index) => Math.sin(elapsed + index / 7) * 0.35) } } }
    ];
    this.adapter.apply(messages.map((message) => JSON.stringify(message)).join(""));
  }
}

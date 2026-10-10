export const HEIGHT_INIT = 1.22;

export const VIEW_FRAME_FROM_DEVICE_FRAME = Object.freeze([
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 0]
]);

const arOxFisheye = Object.freeze({ width: 1928, height: 1208, focalLength: 567 });
const osFisheye = Object.freeze({ width: 1344, height: 760, focalLength: 425.25 });
const arOxConfig = Object.freeze({
  fcam: { width: 1928, height: 1208, focalLength: 2648 },
  ecam: arOxFisheye
});
const osConfig = Object.freeze({
  fcam: { width: 1344, height: 760, focalLength: 1141.5 },
  ecam: osFisheye
});

const cameraMap = new Map([
  ["tici:ar0231", arOxConfig], ["tici:ox03c10", arOxConfig], ["tici:os04c10", osConfig], ["tici:unknown", arOxConfig],
  ["tizi:ar0231", arOxConfig], ["tizi:ox03c10", arOxConfig], ["tizi:os04c10", osConfig],
  ["mici:ar0231", arOxConfig], ["mici:ox03c10", arOxConfig], ["mici:os04c10", osConfig],
  ["unknown:ar0231", arOxConfig], ["unknown:ox03c10", arOxConfig], ["pc:unknown", arOxConfig]
]);

export const DEFAULT_DEVICE_CAMERA = arOxConfig;

export function cameraFor(deviceType, sensor) {
  return cameraMap.get(`${deviceType}:${sensor}`) ?? DEFAULT_DEVICE_CAMERA;
}

export function matmul3x3(a, b) {
  return Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) =>
    a[row][0] * b[0][column] + a[row][1] * b[1][column] + a[row][2] * b[2][column]
  ));
}

export function matvec3(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
  ];
}

export function rotFromEuler([roll = 0, pitch = 0, yaw = 0]) {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr]
  ];
}

export function calibrationMatrix(state) {
  if (state.rpyCalib.length !== 3 || state.calStatus !== "calibrated") {
    return VIEW_FRAME_FROM_DEVICE_FRAME;
  }
  const deviceFromCalib = rotFromEuler(state.rpyCalib);
  if (state.streamType === "wideRoad" && state.wideFromDeviceEuler.length === 3) {
    return matmul3x3(VIEW_FRAME_FROM_DEVICE_FRAME, matmul3x3(rotFromEuler(state.wideFromDeviceEuler), deviceFromCalib));
  }
  return matmul3x3(VIEW_FRAME_FROM_DEVICE_FRAME, deviceFromCalib);
}

export function calculateFrameMatrix(state, screenWidth, screenHeight) {
  return calculateFrameTransform(state, screenWidth, screenHeight).matrix;
}

export function calculateFrameTransform(state, screenWidth, screenHeight) {
  const wide = state.streamType === "wideRoad";
  const config = cameraFor(state.deviceType, state.sensor);
  const camera = wide ? config.ecam : config.fcam;
  const scale = screenHeight / 1080;
  const border = state.hudLayout === "classic" ? 30 * scale : 0;
  const w = screenWidth - 2 * border, h = screenHeight - 2 * border;
  const cx = camera.width / 2, cy = camera.height / 2;
  const zoom = Math.max((wide ? 2 : 1.1) * scale, w / camera.width, h / camera.height);
  const intrinsic = [
    [camera.focalLength, 0, cx],
    [0, camera.focalLength, cy],
    [0, 0, 1]
  ];
  const calibrated = matmul3x3(intrinsic, calibrationMatrix(state));
  const horizon = matvec3(calibrated, [1000, 0, 0]);
  const limitX = Math.max(0, cx * zoom - w / 2 - 5 * scale);
  const limitY = Math.max(0, cy * zoom - h / 2 - 5 * scale);
  const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));
  const dx = Math.abs(horizon[2]) > 1e-6 ? clamp((horizon[0] / horizon[2] - cx) * zoom, limitX) : 0;
  const dy = Math.abs(horizon[2]) > 1e-6 ? clamp((horizon[1] / horizon[2] - cy) * zoom, limitY) : 0;
  const left = screenWidth / 2 - dx - cx * zoom, top = screenHeight / 2 - dy - cy * zoom;
  return { left, top, width: camera.width * zoom, height: camera.height * zoom,
    matrix: matmul3x3([[zoom, 0, left], [0, zoom, top], [0, 0, 1]], calibrated) };
}

export function projectPoint(matrix, [x, y, z], clip) {
  const point = matvec3(matrix, [x, y, z]);
  if (Math.abs(point[2]) < 1e-6) return null;
  const projected = { x: point[0] / point[2], y: point[1] / point[2] };
  if (clip && (projected.x < clip.left || projected.x > clip.right || projected.y < clip.top || projected.y > clip.bottom)) return null;
  return projected;
}

export function pathLengthIndex(points, distance) {
  let result = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index] <= distance) result = index;
  }
  return result;
}

export function lineToPolygon(matrix, xList, yList, zList, {
  yOffset,
  zOffset = 0,
  maxIndex,
  maxDistance,
  allowInvert = true,
  clip
}) {
  const length = Math.min(xList.length, yList.length, zList.length);
  if (!length) return [];
  const left = [];
  const right = [];

  const addPair = (x, y, z) => {
    const leftPoint = projectPoint(matrix, [x, y - yOffset, z + zOffset], clip);
    const rightPoint = projectPoint(matrix, [x, y + yOffset, z + zOffset], clip);
    if (leftPoint && rightPoint) {
      left.push(leftPoint);
      right.push(rightPoint);
    }
  };

  const end = Math.min(maxIndex + 1, length);
  for (let index = 0; index < end; index += 1) {
    if (xList[index] >= 0) addPair(xList[index], yList[index], zList[index]);
  }

  if (maxIndex > 0 && maxIndex < length - 1) {
    const x0 = xList[maxIndex], x1 = xList[maxIndex + 1];
    if (x1 !== x0) {
      const t = (maxDistance - x0) / (x1 - x0);
      addPair(maxDistance, yList[maxIndex] + t * (yList[maxIndex + 1] - yList[maxIndex]), zList[maxIndex] + t * (zList[maxIndex + 1] - zList[maxIndex]));
    }
  }

  if (!allowInvert && left.length > 1) {
    let minimumY = left[0].y;
    const indexes = [0];
    for (let index = 1; index < left.length; index += 1) {
      if (left[index].y <= minimumY) {
        minimumY = left[index].y;
        indexes.push(index);
      }
    }
    return [...indexes.map((index) => left[index]), ...indexes.toReversed().map((index) => right[index])];
  }

  return [...left, ...right.toReversed()];
}

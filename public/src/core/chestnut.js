export const CHESTNUT_STALE_MS = 3000;
export const CHESTNUT_HISTORY_MS = 60000;

export function createChestnutState() {
  return { receivedAt: null, monoTime: null, valid: false, gpuAvailable: false, values: {}, history: [] };
}

const finite = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

export function updateChestnut(record, data, metadata = {}, now = Date.now()) {
  const monoTime = metadata.logMonoTime == null ? null : finite(Number(metadata.logMonoTime), 0, Number.MAX_VALUE);
  if (monoTime !== null && record.monoTime !== null && monoTime <= record.monoTime) return false;
  const previousAt = record.receivedAt;
  record.receivedAt = now;
  record.monoTime = monoTime ?? record.monoTime;
  record.valid = metadata.valid === true;
  record.values = {};
  record.gpuAvailable = false;
  if (record.valid) {
    const v = record.values;
    for (const [key, max] of [["tempC",150],["memoryTempC",150],["powerDrawW",1000],["powerLimitW",1000],
      ["gpuUsagePercent",100],["gpuClockMhz",10000],["fanSpeedRpm",65535],["pcieLtssm",255]]) {
      v[key] = finite(data[key], 0, max);
    }
    const voltage = finite(data.supplyVoltage, 0, 65535), current = finite(data.supplyCurrent, -32768, 32767);
    v.supplyVoltage = voltage === null ? null : voltage / 1000;
    v.supplyCurrent = current === null ? null : current / 1000;
    v.supplyFault = typeof data.supplyFault === "boolean" ? data.supplyFault : null;
    // modeld sends a zero-filled GPU struct while using the small-model fallback.
    // Do not misrepresent those defaults as measured 0°C/0W GPU readings.
    record.gpuAvailable = v.powerLimitW > 0 || v.gpuClockMhz > 0;
    if (!record.gpuAvailable) for (const key of ["tempC","memoryTempC","powerDrawW","powerLimitW","gpuUsagePercent","gpuClockMhz","fanSpeedRpm"]) v[key] = null;
  }
  // Receipt-time history: bounded, at most 1 Hz, with explicit breaks after
  // invalid/stale data. Do not interpolate or fabricate cached GPU measurements.
  if (now < (previousAt ?? now)) record.history = [];
  record.history = record.history.filter(sample => sample.t >= now - CHESTNUT_HISTORY_MS);
  const watts = record.values.powerDrawW;
  if (!record.valid || watts == null || (previousAt !== null && now - previousAt > CHESTNUT_STALE_MS)) record.breakTrace = true;
  if (record.valid && watts != null && (!record.history.length || now - record.history.at(-1).t >= 1000)) {
    record.history.push({ t: now, watts, limit: record.values.powerLimitW, gap: Boolean(record.breakTrace) });
    record.breakTrace = false;
    record.history = record.history.slice(-61);
  }
  return true;
}

export function chestnutStatus(record, now = Date.now()) {
  if (!record || record.receivedAt === null) return "UNAVAILABLE";
  if (now - record.receivedAt > CHESTNUT_STALE_MS) return "STALE";
  return record.valid ? "LIVE" : "INVALID";
}

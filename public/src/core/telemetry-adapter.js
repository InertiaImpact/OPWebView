import { applyTelemetry } from "./state.js?v=5";
import { createChestnutState } from "./chestnut.js";
export const MAX_TELEMETRY_BUFFER = 1024 * 1024;

export class CerealAdapter {
  constructor(store, { maxBuffer = MAX_TELEMETRY_BUFFER, onDiscard = () => {} } = {}) {
    this.store = store;
    this.buffer = "";
    this.maxBuffer = maxBuffer;
    this.onDiscard = onDiscard;
    this.lastAppliedTypes = new Set();
  }

  apply(chunk) {
    this.lastAppliedTypes.clear();
    const text = String(chunk ?? "");
    if (this.buffer.length + text.length > this.maxBuffer) {
      this.buffer = "";
      this.onDiscard("Telemetry buffer limit exceeded; incomplete data discarded");
      if (text.length > this.maxBuffer) return 0;
    }
    this.buffer += text;
    const { objects, remainder } = extractJsonObjects(this.buffer);
    this.buffer = remainder;
    let applied = 0;

    for (const raw of objects) {
      try {
        const message = parseTelemetryJson(raw);
        if (typeof message.type === "string" && applyTelemetry(this.store, message.type, message.data, message)) {
          applied += 1;
          this.lastAppliedTypes.add(message.type);
        }
      } catch {
        // A malformed telemetry object is isolated and skipped; later objects remain usable.
      }
    }
    return applied;
  }

  reset() {
    this.buffer = "";
    this.lastAppliedTypes.clear();
    this.store.update((state) => { state.chestnut = createChestnutState(); });
  }
}

export function parseTelemetryJson(raw) {
  try { return JSON.parse(raw); } catch {
    // Some forks emit bare NaN. Never replace tokens inside valid JSON strings,
    // including escaped quotes/backslashes in road names and alert text.
    const repaired = raw.replace(/"(?:\\[\s\S]|[^"\\])*"|\bNaN\b/g,
      (token) => token === "NaN" ? "null" : token);
    return JSON.parse(repaired);
  }
}

export function extractJsonObjects(input) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        objects.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return { objects, remainder: start === -1 ? "" : input.slice(start) };
}

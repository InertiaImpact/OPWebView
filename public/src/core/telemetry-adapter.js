import { applyTelemetry } from "./state.js";

export class CerealAdapter {
  constructor(store) {
    this.store = store;
    this.buffer = "";
  }

  apply(chunk) {
    this.buffer += String(chunk ?? "");
    const { objects, remainder } = extractJsonObjects(this.buffer);
    this.buffer = remainder;
    let applied = 0;

    for (const raw of objects) {
      try {
        const message = JSON.parse(raw.replace(/\bNaN\b/g, "null"));
        if (typeof message.type === "string" && applyTelemetry(this.store, message.type, message.data)) {
          applied += 1;
        }
      } catch {
        // A malformed telemetry object is isolated and skipped; later objects remain usable.
      }
    }
    return applied;
  }

  reset() {
    this.buffer = "";
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

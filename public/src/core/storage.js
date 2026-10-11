// Storage is optional: blocked access or quota errors must never stop the app.
export function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function writeStored(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch {}
}

export function removeStored(storage, key) {
  try { storage?.removeItem(key); } catch {}
}

// Each consumer owns its schema/migration. Rewrite only repaired records;
// unknown formats are discarded for this key, never by clearing site data.
export function readStored(storage, key, fallback, normalize) {
  let raw;
  try { raw = storage?.getItem(key); } catch { return fallback; }
  if (raw == null) return fallback;
  try {
    const value = normalize(JSON.parse(raw));
    if (value == null) throw new Error("Unsupported saved format");
    if (JSON.stringify(value) !== raw) writeStored(storage, key, value);
    return value;
  } catch {
    removeStored(storage, key);
    return fallback;
  }
}

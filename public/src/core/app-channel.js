export const APP_CHANNEL = globalThis.document?.documentElement?.dataset.channel === "dev" ? "dev" : "stable";
export function storageKey(key) {
  return APP_CHANNEL === "dev" ? key.replace(/^opwebview\./, "opwebview.dev.") : key;
}

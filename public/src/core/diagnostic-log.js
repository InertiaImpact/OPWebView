const STORAGE_KEY = "opwebview.diagnostics.v1";
const MAX_ENTRIES = 100;
const MAX_FIELD_LENGTH = 500;

export const APP_BUILD = "2026.10.10-offline-updates.1";

export class DiagnosticLog extends EventTarget {
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
    this.entries = this.load();
  }

  add(level, source, message, detail) {
    const entry = {
      at: new Date().toISOString(),
      level: String(level || "info"),
      source: clip(source || "app", 60),
      message: clip(message || "", MAX_FIELD_LENGTH)
    };
    const cleanDetail = sanitizeDetail(detail);
    if (cleanDetail !== undefined) entry.detail = cleanDetail;
    this.entries.push(entry);
    this.entries = this.entries.slice(-MAX_ENTRIES);
    this.save();
    this.dispatchEvent(new CustomEvent("change", { detail: entry }));
    return entry;
  }

  clear() {
    this.entries = [];
    this.save();
    this.add("info", "diagnostics", "Diagnostic log cleared");
  }

  context() {
    return diagnosticContext();
  }

  text() {
    const context = this.context();
    const header = [
      `OP WebView diagnostic log`,
      `Build: ${APP_BUILD}`,
      `Generated: ${new Date().toISOString()}`,
      `Page: ${context.page}`,
      `Browser: ${context.userAgent}`,
      `Online: ${context.online}; secure context: ${context.secure}; installed: ${context.installed}`,
      ""
    ];
    const lines = this.entries.map((entry) => {
      const detail = entry.detail === undefined ? "" : ` ${JSON.stringify(entry.detail)}`;
      return `${entry.at} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}${detail}`;
    });
    return [...header, ...lines].join("\n");
  }

  qrPayload(maxBytes = 1200) {
    return compactDiagnosticPayload(this.entries, this.context(), maxBytes);
  }

  load() {
    try {
      const value = JSON.parse(this.storage?.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.slice(-MAX_ENTRIES) : [];
    } catch {
      return [];
    }
  }

  save() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries)); } catch {}
  }
}

export function compactDiagnosticPayload(entries, context, maxBytes = 1200) {
  const compactEntries = entries.slice(-24).map((entry) => ({
    t: entry.at,
    l: entry.level,
    s: entry.source,
    m: clip(entry.message, 240),
    ...(entry.detail === undefined ? {} : { d: sanitizeDetail(entry.detail, 240) })
  }));
  const payload = {
    format: "opwebview-diagnostics-v1",
    build: APP_BUILD,
    generated: new Date().toISOString(),
    context,
    events: compactEntries
  };
  while (payload.events.length > 1 && byteLength(JSON.stringify(payload)) > maxBytes) payload.events.shift();
  let encoded = JSON.stringify(payload);
  if (byteLength(encoded) > maxBytes) {
    payload.context = { page: context?.page, online: context?.online, secure: context?.secure };
    encoded = JSON.stringify(payload);
  }
  return encoded;
}

function diagnosticContext() {
  const nav = globalThis.navigator || {};
  const location = globalThis.location;
  return {
    page: location ? `${location.origin}${location.pathname}` : "unknown",
    online: nav.onLine ?? null,
    secure: globalThis.isSecureContext ?? null,
    installed: globalThis.matchMedia?.("(display-mode: standalone)")?.matches || Boolean(nav.standalone),
    userAgent: clip(nav.userAgent || "unknown", 220),
    language: nav.language || "unknown",
    viewport: globalThis.innerWidth && globalThis.innerHeight ? `${globalThis.innerWidth}x${globalThis.innerHeight}` : "unknown"
  };
}

function sanitizeDetail(value, limit = MAX_FIELD_LENGTH) {
  if (value === undefined) return undefined;
  if (value instanceof Error) return {
    name: value.name,
    message: clip(value.message, limit),
    ...(value.cause ? { cause: clip(value.cause.message || String(value.cause), 160) } : {})
  };
  if (typeof value === "string") return clip(value, limit);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= limit) return JSON.parse(json);
    return `${json.slice(0, limit)}…`;
  } catch {
    return clip(String(value), limit);
  }
}

function clip(value, limit) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

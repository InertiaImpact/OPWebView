import { APP_CHANNEL, storageKey } from "./app-channel.js";
import { browserStorage, readStored, writeStored } from "./storage.js";
const STORAGE_KEY = storageKey("opwebview.diagnostics.v1");
const MAX_ENTRIES = 100;
const MAX_FIELD_LENGTH = 500;

export const APP_BUILD = `2026.10.18-lead-anchor.1-${APP_CHANNEL}`;

export class DiagnosticLog extends EventTarget {
  constructor(storage = browserStorage()) {
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
    return readStored(this.storage, STORAGE_KEY, [], (value) => {
      if (!Array.isArray(value)) return null;
      return value.filter((entry) => entry && typeof entry === "object" &&
        typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at)) &&
        ["info", "warn", "error"].includes(entry.level) &&
        typeof entry.source === "string" && typeof entry.message === "string")
        .slice(-MAX_ENTRIES).map((entry) => ({ at: entry.at, level: entry.level,
          source: clip(entry.source, 60), message: clip(entry.message, MAX_FIELD_LENGTH),
          ...(entry.detail === undefined ? {} : { detail: sanitizeDetail(entry.detail) }) }));
    });
  }

  save() {
    writeStored(this.storage, STORAGE_KEY, this.entries);
  }
}

export function compactDiagnosticPayload(entries, context, maxBytes = 1200) {
  const latestProblem = entries.findLast((entry) => ["warn", "error"].includes(entry.level));
  const recent = entries.slice(-24);
  if (latestProblem && !recent.includes(latestProblem)) recent.unshift(latestProblem);
  const compactEntries = recent.map((entry) => ({
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
  const problem = compactEntries[recent.indexOf(latestProblem)];
  while (payload.events.length > 1 && byteLength(JSON.stringify(payload)) > maxBytes) {
    const removable = payload.events.findIndex((event, index) => event !== problem && index < payload.events.length - 1);
    if (removable < 0) break;
    payload.events.splice(removable, 1);
  }
  let encoded = JSON.stringify(payload);
  if (byteLength(encoded) > maxBytes) {
    payload.context = { page: context?.page, online: context?.online, secure: context?.secure };
    encoded = JSON.stringify(payload);
  }
  // UTF-8 characters and escaped JSON can use several bytes per character.
  // Shrink fields, not the protected failure/recovery events, when necessary.
  for (let limit = 100; byteLength(encoded) > maxBytes && limit >= 10; limit = Math.floor(limit / 2)) {
    for (const event of payload.events) {
      event.m = clip(event.m, limit);
      if (event.d !== undefined) event.d = sanitizeDetail(event.d, limit);
    }
    encoded = JSON.stringify(payload);
  }
  return encoded;
}

// Lossless, optional full-log transfer. Numbered parts share an ID and must be
// joined in order by a QR decoder/LLM; no compression or new dependency needed.
export function fullLogQrPages(text, maxBytes = 1200) {
  const characters = Array.from(String(text));
  const header = {
    format: "opwebview-log-chunk-v1", build: APP_BUILD,
    id: globalThis.crypto?.randomUUID?.() || new Date().toISOString(),
    part: characters.length + 1, total: characters.length + 1
  };
  if (byteLength(JSON.stringify({ ...header, text: "" })) > maxBytes) throw new Error("QR byte budget is too small for log metadata.");
  const chunks = [];
  let chunk = "";
  for (const character of characters) {
    if (byteLength(JSON.stringify({ ...header, text: chunk + character })) > maxBytes) {
      if (!chunk) throw new Error("QR byte budget is too small for log metadata.");
      chunks.push(chunk);
      chunk = character;
    } else chunk += character;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks.map((text, index) => JSON.stringify({ ...header, part: index + 1, total: chunks.length, text }));
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

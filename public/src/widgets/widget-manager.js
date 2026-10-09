import { displaySpeed, isCruiseSet, setSpeed } from "../core/state.js";

const STORAGE_KEY = "opwebview.layout.v1";

export const WIDGETS = Object.freeze([
  {
    id: "speed",
    title: "Current speed",
    className: "minimal",
    layout: { x: 40, y: 1, w: 20, h: 27 },
    render(state) {
      return `<span class="widget-kicker">Current speed</span><strong class="widget-value">${Math.round(displaySpeed(state))}</strong><span class="widget-unit">${state.isMetric ? "km/h" : "mph"}</span>`;
    }
  },
  {
    id: "cruise",
    title: "Set speed",
    layout: { x: 2, y: 4, w: 15, h: 21 },
    render(state) {
      const value = isCruiseSet(state) ? Math.round(setSpeed(state)) : "—";
      return `<span class="widget-kicker">Max</span><strong class="widget-value medium">${value}</strong><span class="widget-unit">${state.isMetric ? "km/h" : "mph"}</span>`;
    }
  },
  {
    id: "lead",
    title: "Lead vehicle",
    layout: { x: 79, y: 56, w: 18, h: 19 },
    render(state) {
      const lead = state.leadOne;
      const present = lead && (lead.status === true || lead.present === true);
      const distance = present ? Math.max(0, Number(lead.dRel) || 0) : null;
      return `<span class="widget-kicker">Lead distance</span><strong class="widget-value medium">${distance === null ? "—" : Math.round(distance)}</strong><span class="widget-unit">${distance === null ? "No lead" : "meters"}</span>`;
    }
  },
  {
    id: "drive",
    title: "Drive state",
    layout: { x: 2, y: 72, w: 22, h: 20 },
    render(state) {
      const label = state.status === "engaged" ? "Engaged" : state.status === "override" ? "Override" : "Standby";
      const camera = state.streamType === "wideRoad" ? "Wide road camera" : "Road camera";
      return `<span class="widget-kicker">Openpilot</span><strong class="widget-value small">${label}</strong><span class="widget-detail">${camera}</span>`;
    }
  },
  {
    id: "device",
    title: "Device data",
    layout: { x: 78, y: 4, w: 19, h: 18 },
    render(state) {
      const name = state.deviceType || "Awaiting data";
      return `<span class="widget-kicker">Device</span><strong class="widget-value small">${escapeHtml(name)}</strong><span class="widget-detail">${escapeHtml(state.sensor || "Camera sensor unknown")}</span>`;
    }
  }
]);

export class WidgetManager extends EventTarget {
  constructor({ layer, toggles, store, storage = globalThis.localStorage }) {
    super();
    this.layer = layer;
    this.toggles = toggles;
    this.store = store;
    this.storage = storage;
    this.layout = this.loadLayout();
    this.editing = false;
    this.elements = new Map();
    this.build();
    this.render();
    store.addEventListener("change", () => this.render());
  }

  defaultLayout() {
    return Object.fromEntries(WIDGETS.map((widget) => [widget.id, { ...widget.layout, hidden: false }]));
  }

  loadLayout() {
    const defaults = this.defaultLayout();
    try {
      const saved = JSON.parse(this.storage.getItem(STORAGE_KEY) || "{}");
      for (const widget of WIDGETS) {
        if (saved[widget.id]) defaults[widget.id] = { ...defaults[widget.id], ...saved[widget.id] };
      }
    } catch {}
    return defaults;
  }

  save() {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.layout));
  }

  build() {
    this.layer.replaceChildren();
    this.toggles.replaceChildren();
    for (const definition of WIDGETS) {
      const element = document.createElement("article");
      element.className = `dashboard-widget ${definition.className || ""}`.trim();
      element.dataset.widgetId = definition.id;
      element.tabIndex = -1;
      element.innerHTML = `
        <div class="widget-surface"></div>
        <div class="widget-edit-bar"><span>${definition.title}</span><button class="widget-hide" type="button" aria-label="Hide ${definition.title}">×</button></div>
        <button class="widget-resize" type="button" aria-label="Resize ${definition.title}"></button>`;
      this.layer.append(element);
      this.elements.set(definition.id, element);
      this.applyLayout(definition.id);
      element.querySelector(".widget-edit-bar").addEventListener("pointerdown", (event) => this.startDrag(event, definition.id));
      element.querySelector(".widget-resize").addEventListener("pointerdown", (event) => this.startResize(event, definition.id));
      element.querySelector(".widget-hide").addEventListener("click", () => this.setVisible(definition.id, false));

      const row = document.createElement("div");
      row.className = "widget-toggle";
      row.innerHTML = `<label for="widget-${definition.id}">${definition.title}</label><input id="widget-${definition.id}" type="checkbox" />`;
      const checkbox = row.querySelector("input");
      checkbox.checked = !this.layout[definition.id].hidden;
      checkbox.addEventListener("change", () => this.setVisible(definition.id, checkbox.checked));
      this.toggles.append(row);
    }
  }

  render() {
    for (const definition of WIDGETS) {
      this.elements.get(definition.id).querySelector(".widget-surface").innerHTML = definition.render(this.store.state);
    }
  }

  setEditing(value) {
    this.editing = Boolean(value);
    this.layer.classList.toggle("editing", this.editing);
    for (const element of this.elements.values()) element.tabIndex = this.editing ? 0 : -1;
    this.dispatchEvent(new CustomEvent("editing", { detail: this.editing }));
  }

  setVisible(id, visible) {
    this.layout[id].hidden = !visible;
    this.applyLayout(id);
    const checkbox = this.toggles.querySelector(`#widget-${id}`);
    if (checkbox) checkbox.checked = visible;
    this.save();
  }

  reset() {
    this.layout = this.defaultLayout();
    for (const definition of WIDGETS) {
      this.applyLayout(definition.id);
      const checkbox = this.toggles.querySelector(`#widget-${definition.id}`);
      if (checkbox) checkbox.checked = true;
    }
    this.save();
  }

  applyLayout(id) {
    const element = this.elements.get(id);
    const layout = this.layout[id];
    if (!element || !layout) return;
    element.style.setProperty("--x", layout.x);
    element.style.setProperty("--y", layout.y);
    element.style.setProperty("--w", layout.w);
    element.style.setProperty("--h", layout.h);
    element.hidden = Boolean(layout.hidden);
  }

  startDrag(event, id) {
    if (!this.editing || event.target.closest("button")) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...this.layout[id] };
    this.trackPointer(event, ({ dx, dy }) => {
      const bounds = this.layer.getBoundingClientRect();
      this.layout[id].x = snap(clamp(start.x + dx / bounds.width * 100, 0, 100 - start.w));
      this.layout[id].y = snap(clamp(start.y + dy / bounds.height * 100, 0, 100 - start.h));
      this.applyLayout(id);
    });
  }

  startResize(event, id) {
    if (!this.editing) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, ...this.layout[id] };
    this.trackPointer(event, ({ dx, dy }) => {
      const bounds = this.layer.getBoundingClientRect();
      this.layout[id].w = snap(clamp(start.w + dx / bounds.width * 100, 10, 100 - start.x));
      this.layout[id].h = snap(clamp(start.h + dy / bounds.height * 100, 12, 100 - start.y));
      this.applyLayout(id);
    });
  }

  trackPointer(event, onMove) {
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    target.setPointerCapture(pointerId);
    const move = (next) => onMove({ dx: next.clientX - origin.x, dy: next.clientY - origin.y });
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      this.save();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const snap = (value) => Math.round(value * 2) / 2;
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

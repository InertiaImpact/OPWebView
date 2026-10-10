import { WIDGETS } from "./widget-catalog.js";
import { BUILT_IN_LAYOUTS, createPresetLayout, normalizeLayout, sanitizeLayoutName } from "./layout-presets.js";

const STORAGE_KEY = "opwebview.layout.v2";
const NAMED_KEY = "opwebview.layouts.named.v1";
const LEGACY_KEY = "opwebview.layout.v1";

export { WIDGETS, BUILT_IN_LAYOUTS, createPresetLayout, sanitizeLayoutName };

export class WidgetManager extends EventTarget {
  constructor({ layer, toggles, store, storage = globalThis.localStorage }) {
    super();
    this.layer = layer;
    this.toggles = toggles;
    this.store = store;
    this.storage = storage;
    const saved = this.loadLayout();
    this.layout = saved.layout;
    this.activeLayout = saved.activeLayout;
    this.editing = false;
    this.elements = new Map();
    this.build();
    this.render();
    store.addEventListener("change", () => this.render());
  }

  loadLayout() {
    try {
      const saved = JSON.parse(this.storage.getItem(STORAGE_KEY) || "null");
      if (saved?.layout) return { layout: normalizeLayout(saved.layout), activeLayout: saved.activeLayout || "custom" };
    } catch {}
    try {
      const legacy = JSON.parse(this.storage.getItem(LEGACY_KEY) || "null");
      if (legacy) {
        const migrated = createPresetLayout("classic");
        for (const widget of WIDGETS) {
          if (!legacy[widget.id]) migrated[widget.id].hidden = true;
          else migrated[widget.id] = { ...migrated[widget.id], ...legacy[widget.id] };
        }
        return { layout: migrated, activeLayout: "custom" };
      }
    } catch {}
    return { layout: createPresetLayout("classic"), activeLayout: "classic" };
  }

  save() {
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, activeLayout: this.activeLayout, layout: this.layout }));
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
      const surface = this.elements.get(definition.id)?.querySelector(".widget-surface");
      if (!surface) continue;
      const html = definition.render(this.store.state);
      if (surface.__renderedHtml !== html) {
        surface.innerHTML = html;
        surface.__renderedHtml = html;
      }
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
    this.markCustom();
    this.applyLayout(id);
    const checkbox = this.toggles.querySelector(`#widget-${id}`);
    if (checkbox) checkbox.checked = visible;
    this.save();
  }

  applyPreset(id) {
    if (!BUILT_IN_LAYOUTS[id]) return false;
    this.layout = createPresetLayout(id);
    this.activeLayout = id;
    this.applyAll();
    this.save();
    this.emitLayoutChange();
    return true;
  }

  reset() {
    this.applyPreset(BUILT_IN_LAYOUTS[this.activeLayout] ? this.activeLayout : "classic");
  }

  namedLayouts() {
    try {
      const saved = JSON.parse(this.storage.getItem(NAMED_KEY) || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  saveNamed(rawName) {
    const name = sanitizeLayoutName(rawName);
    if (!name) return null;
    const layouts = this.namedLayouts();
    layouts[name] = normalizeLayout(this.layout);
    this.storage.setItem(NAMED_KEY, JSON.stringify(layouts));
    this.activeLayout = `saved:${name}`;
    this.save();
    this.emitLayoutChange();
    return name;
  }

  applyNamed(name) {
    const saved = this.namedLayouts()[name];
    if (!saved) return false;
    this.layout = normalizeLayout(saved);
    this.activeLayout = `saved:${name}`;
    this.applyAll();
    this.save();
    this.emitLayoutChange();
    return true;
  }

  deleteNamed(name) {
    const layouts = this.namedLayouts();
    if (!layouts[name]) return false;
    delete layouts[name];
    this.storage.setItem(NAMED_KEY, JSON.stringify(layouts));
    if (this.activeLayout === `saved:${name}`) this.activeLayout = "custom";
    this.save();
    this.emitLayoutChange();
    return true;
  }

  activeLabel() {
    if (BUILT_IN_LAYOUTS[this.activeLayout]) return BUILT_IN_LAYOUTS[this.activeLayout].name;
    if (this.activeLayout.startsWith("saved:")) return this.activeLayout.slice(6);
    return "Custom";
  }

  applyAll() {
    for (const definition of WIDGETS) {
      this.applyLayout(definition.id);
      const checkbox = this.toggles.querySelector(`#widget-${definition.id}`);
      if (checkbox) checkbox.checked = !this.layout[definition.id].hidden;
    }
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

  markCustom() {
    this.activeLayout = "custom";
    this.emitLayoutChange();
  }

  emitLayoutChange() {
    this.dispatchEvent(new CustomEvent("layoutchange", { detail: { id: this.activeLayout, label: this.activeLabel() } }));
  }

  startDrag(event, id) {
    if (!this.editing || event.target.closest("button")) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...this.layout[id] };
    this.markCustom();
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
    this.markCustom();
    this.trackPointer(event, ({ dx, dy }) => {
      const bounds = this.layer.getBoundingClientRect();
      this.layout[id].w = snap(clamp(start.w + dx / bounds.width * 100, 7, 100 - start.x));
      this.layout[id].h = snap(clamp(start.h + dy / bounds.height * 100, 8, 100 - start.y));
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

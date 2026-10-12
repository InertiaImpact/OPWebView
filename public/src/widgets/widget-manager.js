import { WIDGETS } from "./widget-catalog.js";
import { BUILT_IN_LAYOUTS, createPresetLayout, normalizeLayout, presetGeometry, sanitizeLayoutName } from "./layout-presets.js";

import { storageKey } from "../core/app-channel.js";
import { IndicatorSmoother } from "./indicator-smoothing.js";
import { paintIndicator } from "./indicator-renderer.js";
import { browserStorage, readStored, writeStored, removeStored } from "../core/storage.js";
import { trackPointerDrag } from "../core/pointer-drag.js";
const STORAGE_KEY = storageKey("opwebview.layout.v2");
const NAMED_KEY = storageKey("opwebview.layouts.named.v1");
const LEGACY_KEY = storageKey("opwebview.layout.v1");

export { WIDGETS, BUILT_IN_LAYOUTS, createPresetLayout, sanitizeLayoutName };

export class WidgetManager extends EventTarget {
  constructor({ layer, toggles, store, storage = browserStorage() }) {
    super();
    this.layer = layer;
    this.toggles = toggles;
    this.store = store;
    this.storage = storage;
    const saved = this.loadLayout();
    this.layout = saved.layout;
    this.activeLayout = saved.activeLayout;
    this.editing = false;
    this.displayMode = "full";
    this.suspended = false;
    this.collapsed = new Set();
    this.lastRender = 0;
    this.elements = new Map();
    this.indicators = new IndicatorSmoother();
    this.build();
    this.render();
    store.addEventListener("change", () => {
      this.scheduleRender();
      this.scheduleIndicatorAnimation();
    });
    this.resizeObserver = new ResizeObserver(() => this.refreshGeometry());
    this.resizeObserver.observe(layer);
    this.refreshGeometry();
  }

  loadLayout() {
    const saved = readStored(this.storage, STORAGE_KEY, null, (value) => {
      if (!value || (value.version !== undefined && value.version !== 2) || !isLayout(value.layout)) return null;
      const active = typeof value.activeLayout === "string" ? value.activeLayout : "custom";
      const activeLayout = Object.hasOwn(BUILT_IN_LAYOUTS, active) || active === "custom" ||
        (active.startsWith("saved:") && active.slice(6) && sanitizeLayoutName(active.slice(6)) === active.slice(6)) ? active : "custom";
      return { version: 2, activeLayout, layout: normalizeLayout(value.layout, Object.hasOwn(BUILT_IN_LAYOUTS, activeLayout) ? activeLayout : "classic") };
    });
    if (saved) return saved;
    const legacy = readStored(this.storage, LEGACY_KEY, null, (value) => isLayout(value) ? value : null);
    if (legacy) {
      const migrated = createPresetLayout("classic");
      for (const widget of WIDGETS) {
        if (!legacy[widget.id]) migrated[widget.id].hidden = true;
        else migrated[widget.id] = { ...migrated[widget.id], ...legacy[widget.id] };
      }
      const record = { version: 2, layout: normalizeLayout(migrated), activeLayout: "custom" };
      writeStored(this.storage, STORAGE_KEY, record);
      // Keep the old record if migration could not be persisted.
      try { if (this.storage?.getItem(STORAGE_KEY) === JSON.stringify(record)) removeStored(this.storage, LEGACY_KEY); } catch {}
      return record;
    }
    return { layout: createPresetLayout("classic"), activeLayout: "classic" };
  }

  save() {
    writeStored(this.storage, STORAGE_KEY, { version: 2, activeLayout: this.activeLayout, layout: this.layout });
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
      element.addEventListener("click", (event) => {
        if (this.editing || !event.target.closest(".panel-toggle")) return;
        if (this.collapsed.has(definition.id)) this.collapsed.delete(definition.id);
        else this.collapsed.add(definition.id);
        this.refreshGeometry();
        this.render();
      });

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
    if (this.suspended || this.displayMode === "camera") return;
    if (this.geometryMetric !== undefined && this.geometryMetric !== this.store.state.isMetric) { this.refreshGeometry(); return; }
    this.lastRender = performance.now();
    this.layer.dataset.units = this.store.state.isMetric ? "metric" : "imperial";
    const display = this.indicators?.sample(this.store.state, performance.now());
    for (const definition of WIDGETS) {
      this.updateVisibility(definition.id);
      const element = this.elements.get(definition.id);
      if (element?.hidden) continue;
      const surface = element?.querySelector(".widget-surface");
      if (!surface) continue;
      const state = display && ["torque", "confidence"].includes(definition.id)
        ? { ...this.store.state, ...display } : this.store.state;
      if (!paintIndicator(surface, definition.id, state)) {
        const html = definition.render(state);
        if (surface.__renderedHtml !== html) {
          surface.innerHTML = html;
          surface.__renderedHtml = html;
        }
      }
      const collapsed = this.collapsed.has(definition.id);
      element.classList.toggle("collapsed", collapsed);
      const button = surface.querySelector(".panel-toggle");
      if (button) {
        button.setAttribute("aria-expanded", String(!collapsed));
        button.setAttribute("aria-label", `${collapsed ? 'Expand' : 'Fold'} ${definition.title.toLowerCase()} panel`);
        button.querySelector("span").textContent = collapsed ? " ▸" : " ▾";
      }
    }
    if (display?.pending) this.scheduleIndicatorAnimation();
  }

  scheduleIndicatorAnimation() {
    if (!this.indicators || this.suspended || this.displayMode === "camera" || this.indicatorFrame) return;
    if (!["torque", "confidence"].some((id) => {
      const element = this.elements.get(id);
      return element && !element.hidden;
    })) return;
    this.indicatorFrame = requestAnimationFrame((now) => {
      this.indicatorFrame = null;
      if (this.suspended || this.displayMode === "camera") return;
      // Only these two small SVGs animate at 30 fps; graphs/readouts keep their
      // lower paint rate. Do not redraw the camera or projection overlay here.
      if (now - (this.lastIndicatorPaint ?? -Infinity) < 32) {
        this.scheduleIndicatorAnimation();
        return;
      }
      this.lastIndicatorPaint = now;
      const display = this.indicators.sample(this.store.state, now);
      for (const id of ["torque", "confidence"]) {
        const element = this.elements.get(id);
        if (!element || element.hidden) continue;
        const surface = element.querySelector(".widget-surface");
        if (surface) paintIndicator(surface, id, { ...this.store.state, ...display });
      }
      if (display.pending) this.scheduleIndicatorAnimation();
    });
  }

  scheduleRender() {
    if (this.suspended || this.renderTimer) return;
    const delay = Math.max(0, (this.displayMode === "compact" ? 200 : 100) - (performance.now() - this.lastRender));
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, delay);
  }

  setDisplayMode(mode, suspended = false) {
    this.stopDrag?.();
    if (this.indicatorFrame) cancelAnimationFrame(this.indicatorFrame);
    this.indicatorFrame = null;
    this.indicators?.pause();
    this.displayMode = mode;
    this.suspended = suspended;
    this.refreshGeometry();
    this.scheduleIndicatorAnimation();
  }

  refreshGeometry() {
    const { width, height } = this.layer.getBoundingClientRect();
    if (!width || !height) return;
    if (this.bounds && (width !== this.bounds.width || height !== this.bounds.height)) this.stopDrag?.();
    this.bounds = { width, height };
    this.geometryMetric = this.store.state.isMetric;
    const preset = BUILT_IN_LAYOUTS[this.activeLayout] ? this.activeLayout : null;
    const geometry = presetGeometry(preset || "enhanced", width, height, this.store.state.isMetric, this.collapsed);
    this.layer.dataset.layout = preset || "custom";
    this.store.state.hudLayout = preset || "enhanced";
    this.layer.dataset.displayMode = this.displayMode;
    this.layer.style.setProperty("--hud-unit", `${geometry.unit}px`);
    this.layer.closest(".app")?.style.setProperty("--hud-unit", `${geometry.unit}px`);
    this.layer.closest(".app")?.setAttribute("data-layout", preset || "custom");
    this.presentedLayout = preset ? geometry.layout : this.layout;
    if (this.displayMode === "compact") {
      // Temporary presentation only: never replace or save the user's full layout.
      this.presentedLayout = createPresetLayout("enhanced");
      for (const item of Object.values(this.presentedLayout)) item.hidden = true;
      this.presentedLayout.speed = { x: 32, y: 4, w: 36, h: 57, hidden: false };
      this.presentedLayout.torque = { x: 15, y: 63, w: 70, h: 30, hidden: false };
    }
    for (const definition of WIDGETS) this.applyLayout(definition.id);
    this.render();
  }

  setEditing(value) {
    this.stopDrag?.();
    if (value && BUILT_IN_LAYOUTS[this.activeLayout] && this.displayMode === "full") this.layout = structuredClone(this.presentedLayout);
    this.editing = Boolean(value);
    this.layer.classList.toggle("editing", this.editing);
    for (const element of this.elements.values()) element.tabIndex = this.editing ? 0 : -1;
    this.dispatchEvent(new CustomEvent("editing", { detail: this.editing }));
    this.render();
  }

  setVisible(id, visible) {
    this.markCustom();
    this.layout[id].hidden = !visible;
    this.applyLayout(id);
    const checkbox = this.toggles.querySelector(`#widget-${id}`);
    if (checkbox) checkbox.checked = visible;
    this.save();
  }

  applyPreset(id) {
    if (!BUILT_IN_LAYOUTS[id]) return false;
    this.stopDrag?.();
    this.layout = createPresetLayout(id);
    this.activeLayout = id;
    this.applyAll();
    this.save();
    if (this.editing) { this.setEditing(true); this.render(); }
    this.emitLayoutChange();
    return true;
  }

  reset() {
    this.applyPreset(BUILT_IN_LAYOUTS[this.activeLayout] ? this.activeLayout : "classic");
  }

  namedLayouts() {
    return readStored(this.storage, NAMED_KEY, {}, (saved) => {
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
      return Object.fromEntries(Object.entries(saved).filter(([name, layout]) =>
        name && sanitizeLayoutName(name) === name && isLayout(layout)).map(([name, layout]) => [name, normalizeLayout(layout)]));
    });
  }

  saveNamed(rawName) {
    const name = sanitizeLayoutName(rawName);
    if (!name) return null;
    const layouts = this.namedLayouts();
    Object.defineProperty(layouts, name, { value: normalizeLayout(this.displayMode === "full" ? this.presentedLayout || this.layout : this.layout), enumerable: true, configurable: true, writable: true });
    writeStored(this.storage, NAMED_KEY, layouts);
    this.activeLayout = `saved:${name}`;
    this.save();
    this.emitLayoutChange();
    return name;
  }

  applyNamed(name) {
    const layouts = this.namedLayouts();
    const saved = Object.hasOwn(layouts, name) ? layouts[name] : null;
    if (!saved) return false;
    this.stopDrag?.();
    this.layout = normalizeLayout(saved);
    this.activeLayout = `saved:${name}`;
    this.applyAll();
    this.save();
    this.emitLayoutChange();
    return true;
  }

  deleteNamed(name) {
    const layouts = this.namedLayouts();
    if (!Object.hasOwn(layouts, name)) return false;
    delete layouts[name];
    writeStored(this.storage, NAMED_KEY, layouts);
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
    this.refreshGeometry();
    for (const definition of WIDGETS) {
      this.applyLayout(definition.id);
      const checkbox = this.toggles.querySelector(`#widget-${definition.id}`);
      if (checkbox) checkbox.checked = !this.layout[definition.id].hidden;
    }
  }

  applyLayout(id) {
    const element = this.elements.get(id);
    const layout = this.displayMode === "full" && this.editing ? this.layout[id] : (this.presentedLayout || this.layout)[id];
    if (!element || !layout) return;
    element.style.setProperty("--x", layout.x);
    element.style.setProperty("--y", layout.y);
    element.style.setProperty("--w", layout.w);
    element.style.setProperty("--h", layout.h);
    this.updateVisibility(id);
    // Fit custom text against its own widget, instead of the whole screen.
    const { width, height } = this.bounds || this.layer.getBoundingClientRect();
    const reference = { detailedSteering: [112,115], detailedDriver: [112,46], detailedLongitudinal: [112,97], detailedLead: [112,73], steering:[100,68], lead:[100,68], deviceHealth:[82,34] }[id];
    if (reference) {
      const unit = Math.min(width * layout.w / 100 / reference[0], height * layout.h / 100 / reference[1]);
      element.style.setProperty("--widget-unit", `${this.collapsed.has(id) ? width * layout.w / 100 / reference[0] : unit}px`);
    }
  }

  updateVisibility(id) {
    const element = this.elements.get(id);
    const layout = this.displayMode === "full" && this.editing ? this.layout[id] : (this.presentedLayout || this.layout)[id];
    if (!element || !layout) return;
    const state = this.store.state;
    const autoHide = this.displayMode === "full" && !this.editing && BUILT_IN_LAYOUTS[this.activeLayout];
    element.hidden = this.displayMode === "camera" || Boolean(layout.hidden)
      || (autoHide && id === "roadName" && (!state.roadNameToggle || !state.roadName))
      || (autoHide && id === "driver" && (!state.started || !state.dmSeen))
      || (autoHide && id === "confidence" && !state.started)
      || (autoHide && id === "speedLimit" && ((state.paramsSeen && state.speedLimitMode === 0) || !state.speedLimitSeen))
      || (autoHide && id === "cruise" && (state.vCruiseCluster || state.vCruiseDeprecated) === -1)
      || (autoHide && id === "turnSignals" && !state.showTurnSignals);
  }

  markCustom() {
    if (!this.editing && BUILT_IN_LAYOUTS[this.activeLayout] && this.presentedLayout && this.displayMode === "full") this.layout = structuredClone(this.presentedLayout);
    this.activeLayout = "custom";
    this.presentedLayout = this.layout;
    this.layer.dataset.layout = "custom";
    this.emitLayoutChange();
  }

  emitLayoutChange() {
    this.dispatchEvent(new CustomEvent("layoutchange", { detail: { id: this.activeLayout, label: this.activeLabel() } }));
  }

  startDrag(event, id) {
    if (!this.editing || this.displayMode !== "full" || event.isPrimary === false || event.button !== 0 || event.target.closest("button")) return;
    this.stopDrag?.();
    const bounds = this.layer.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    this.markCustom();
    const start = { ...this.layout[id] };
    this.trackPointer(event, ({ dx, dy }) => {
      this.layout[id].x = snap(clamp(start.x + dx / bounds.width * 100, 0, 100 - start.w));
      this.layout[id].y = snap(clamp(start.y + dy / bounds.height * 100, 0, 100 - start.h));
      this.applyLayout(id);
    });
  }

  startResize(event, id) {
    if (!this.editing || this.displayMode !== "full" || event.isPrimary === false || event.button !== 0) return;
    this.stopDrag?.();
    const bounds = this.layer.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    event.stopPropagation();
    this.markCustom();
    const start = { ...this.layout[id] };
    this.trackPointer(event, ({ dx, dy }) => {
      this.layout[id].w = snap(clamp(start.w + dx / bounds.width * 100, 7, 100 - start.x));
      this.layout[id].h = snap(clamp(start.h + dy / bounds.height * 100, 8, 100 - start.y));
      this.applyLayout(id);
    });
  }

  trackPointer(event, onMove) {
    this.stopDrag = trackPointerDrag(event, { onMove, onEnd: () => { this.stopDrag = null; this.save(); } });
  }
}

function isLayout(value) {
  return value && typeof value === "object" && !Array.isArray(value) && WIDGETS.some(({ id }) =>
    Object.hasOwn(value, id) && value[id] && typeof value[id] === "object" && !Array.isArray(value[id]));
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const snap = (value) => Math.round(value * 100) / 100;

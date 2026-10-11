const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x) || 0));

export function traceGraph(history, { label, want, got, color, lo, hi }) {
  const samples = history || [];
  const end = samples.at(-1)?.t || 0;
  const y = (v) => 20 - (clamp(v, lo, hi) - lo) / (hi - lo) * 20;
  const path = (key) => samples.map((sample, i) => {
    // Start a new subpath after gaps, so stale data never looks continuous.
    const command = i === 0 || sample.t - samples[i - 1].t > 500 ? "M" : "L";
    return `${command}${clamp(100 - (end - sample.t) / 100, 0, 100).toFixed(2)},${y(sample[key]).toFixed(2)}`;
  }).join(" ");
  return `<div class="trace"><div class="trace-legend"><span>${label}, 10 s</span><span><i class="want-key"></i>${want} <i style="background:${color}"></i>${got}</span></div><svg viewBox="0 0 100 20" preserveAspectRatio="none" role="img" aria-label="${label}: ${want} versus ${got}, last ten seconds"><path d="M0,${y(0)} H100" class="trace-zero"/><path d="${path(got)}" stroke="${color}" class="trace-got"/><path d="${path(want)}" class="trace-want"/></svg></div>`;
}

// Source arc: 1200 reference-pixel radius, +/-4 degrees from bottom centre.
export function torquePresentation(value, status) {
  const v = clamp(value, -1, 1), mag = Math.abs(v);
  const hot = clamp((mag - .75) * 4, 0, 1);
  const active = ["engaged", "latOnly"].includes(status);
  const thickness = 14 + clamp((mag - .5) * 2, 0, 1) * 42;
  const offset = 26 + clamp((mag - .5) * 2, 0, 1) * 4;
  const radius = 1200 + thickness / 2, cy = 54 + 1200 - offset;
  const point = (angle) => [96 + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
  const arc = (from, to) => {
    const a = point(from), b = point(to);
    return `M${a.join(",")} A${radius},${radius} 0 0 ${to > from ? 1 : 0} ${b.join(",")}`;
  };
  const half = Math.PI / 45;
  const fill = active ? `rgb(255,${Math.round(255 - hot * 140)},${Math.round(255 - hot * 255)})` : "#aaa";
  return { background: arc(-half, half), foreground: arc(0, half * v), fill, thickness,
    opacity: active ? .25 + clamp((mag - .5) * 2, 0, 1) * .25 : .15,
    dotY: cy - radius, showFill: mag > .000001, showDot: mag < .5,
    label: `Steering effort ${(v * 100).toFixed(1)} percent` };
}

export function torqueGraph(value, status) {
  const p = torquePresentation(value, status);
  return `<svg class="torque-arc" viewBox="0 0 192 54" preserveAspectRatio="none" role="img" aria-label="${p.label}"><path d="${p.background}" stroke="white" opacity="${p.opacity}" stroke-width="${p.thickness}"/>${p.showFill ? `<path d="${p.foreground}" stroke="${p.fill}" stroke-width="${p.thickness}"/>` : ""}${p.showDot ? `<circle cx="96" cy="${p.dotY}" r="5" fill="#b6b6b6"/>` : ""}</svg>`;
}

export function confidencePresentation(state) {
  const live = state.status !== "disengaged" && state.confidenceSeen;
  const c = Math.max(0, Math.min(1, state.confidenceFiltered));
  return { live, radius: 8 + 26 * c, className: `driver-symbol ${live ? "" : "inactive"}`,
    colors: c > .5 ? ["#00ffcc", "#00ff26"] : c > .2 ? ["#ffc800", "#ff7300"] : ["#ff0015", "#ff0059"],
    label: `Model confidence ${live ? Math.round(c * 100) + " percent" : "unavailable"}` };
}

export function confidenceGraph(state) {
  const p = confidencePresentation(state);
  return `<svg viewBox="0 0 100 100" class="${p.className}" role="img" aria-label="${p.label}"><defs><linearGradient id="confidence-gradient" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${p.colors[0]}"/><stop offset="1" stop-color="${p.colors[1]}"/></linearGradient></defs><circle cx="50" cy="50" r="40" fill="none" stroke="#ffffff2e" stroke-width="4.5"/>${p.live ? `<circle cx="50" cy="50" r="${p.radius}" fill="url(#confidence-gradient)"/>` : ""}</svg>`;
}

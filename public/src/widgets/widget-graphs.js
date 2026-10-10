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
export function torqueGraph(value, status) {
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
  return `<svg class="torque-arc" viewBox="0 0 192 54" preserveAspectRatio="none" role="img" aria-label="Steering effort ${Math.round(v * 100)} percent"><path d="${arc(-half, half)}" stroke="white" opacity="${active ? .25 + clamp((mag - .5) * 2, 0, 1) * .25 : .15}" stroke-width="${thickness}"/>${mag > .001 ? `<path d="${arc(0, half * v)}" stroke="${fill}" stroke-width="${thickness}"/>` : ""}${mag < .5 ? `<circle cx="96" cy="${cy - radius}" r="5" fill="#b6b6b6"/>` : ""}</svg>`;
}

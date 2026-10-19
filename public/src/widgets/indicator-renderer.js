import { torqueGraph, torquePresentation, confidenceGraph, confidencePresentation } from "./widget-graphs.js";
import { torqueBarValue } from "../core/state.js?v=5";

const attr = (node, name, value) => {
  const text = String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
};
const circle = (svg, attributes) => {
  const node = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [name, value] of Object.entries(attributes)) attr(node, name, value);
  svg.append(node);
  return node;
};

// Build once, then mutate only presentation attributes. Shared presentation
// functions keep the persistent SVG identical to the catalog's static output.
export function paintIndicator(surface, id, state) {
  if (!["torque", "confidence"].includes(id)) return false;
  let nodes = surface.__indicatorNodes;
  if (!nodes) {
    surface.innerHTML = id === "torque" ? torqueGraph(0, "disengaged") : confidenceGraph(state);
    const svg = surface.querySelector("svg");
    if (id === "torque") {
      const fill = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
      const dot = svg.querySelector("circle");
      svg.insertBefore(fill, dot);
      nodes = { svg, background: svg.querySelector("path"), fill, dot };
    } else {
      const ball = svg.querySelector('[fill="url(#confidence-gradient)"]') || circle(svg,
        { cx: 50, cy: 50, fill: "url(#confidence-gradient)" });
      nodes = { svg, ball, stops: svg.querySelectorAll("stop") };
    }
    surface.__indicatorNodes = nodes;
  }
  if (id === "torque") {
    const p = torquePresentation(state.torqueDisplayValue ?? torqueBarValue(state), state.status);
    attr(nodes.svg, "aria-label", p.label);
    attr(nodes.background, "d", p.background);
    attr(nodes.background, "opacity", p.opacity);
    attr(nodes.background, "stroke-width", p.thickness);
    attr(nodes.fill, "d", p.foreground);
    attr(nodes.fill, "stroke", p.fill);
    attr(nodes.fill, "stroke-width", p.thickness);
    attr(nodes.fill, "display", p.showFill ? "inline" : "none");
    attr(nodes.dot, "cy", p.dotY);
    attr(nodes.dot, "display", p.showDot ? "inline" : "none");
  } else {
    const p = confidencePresentation(state);
    attr(nodes.svg, "aria-label", p.label);
    attr(nodes.svg, "class", p.className);
    attr(nodes.ball, "r", p.radius);
    attr(nodes.ball, "display", p.live ? "inline" : "none");
    p.colors.forEach((color, index) => attr(nodes.stops[index], "stop-color", color));
  }
  return true;
}

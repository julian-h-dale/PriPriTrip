import { BedDouble, MapPin, NotebookPen, Route } from "lucide-react";
import {
  BedDouble as BedDoubleNode,
  Bus as BusNode,
  Car as CarNode,
  MapPin as MapPinNode,
  NotebookPen as NotebookPenNode,
  Plane as PlaneNode,
  Plus as PlusNode,
  Route as RouteNode,
  Ship as ShipNode,
  TrainFront as TrainFrontNode,
} from "lucide";
import { MODE_ICON } from "@/features/timeline/describeEntry";

// The pins' glyphs are the same Lucide outline icons as the rest of the app
// (and as iconFor below), drawn white. The map's pins aren't React, so they
// use the vanilla `lucide` package's icon shapes (same version as
// lucide-react), turned into an SVG image once per icon.
const TRAVEL_NODE = {
  flight: PlaneNode,
  train: TrainFrontNode,
  bus: BusNode,
  ferry: ShipNode,
  boat: ShipNode,
  car: CarNode,
  other: RouteNode,
};

function nodeFor(marker) {
  if (marker.kind === "memory") return NotebookPenNode;
  if (marker.kind === "stay") return BedDoubleNode;
  if (marker.kind === "travel") return TRAVEL_NODE[marker.mode] ?? RouteNode;
  return MapPinNode;
}

function attrs(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
}

/** A Lucide icon node (`["svg", attrs, children]`) as an SVG data URL. */
function svgDataUrl([, svgAttrs, children], stroke = "#fff") {
  const body = children.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join("");
  const svg = `<svg ${attrs({ ...svgAttrs, stroke })}>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const glyphCache = new Map();

/** The pin's glyph image (an SVG data URL) for a marker's kind/mode. */
export function glyphSrcFor(marker) {
  const node = nodeFor(marker);
  if (!glyphCache.has(node)) glyphCache.set(node, svgDataUrl(node));
  return glyphCache.get(node);
}

/** The glyph for a picked Google place that isn't on the trip yet: a dark
 * "+" outline, for the white pin. */
export const NEW_PLACE_GLYPH_SRC = svgDataUrl(PlusNode, "#12151c");

export function colorFor(marker) {
  if (marker.kind === "memory") return "#d65a8c"; // --series-5, memories
  if (marker.kind === "stay") return "#3987e5"; // --series-1
  if (marker.kind === "travel") return "#d95926"; // --series-2
  return "#9085e9"; // --series-7, activities
}

/** The same icons as the pins, as React components for React-rendered lists. */
export function iconFor(marker) {
  if (marker.kind === "memory") return NotebookPen;
  if (marker.kind === "stay") return BedDouble;
  if (marker.kind === "travel") return MODE_ICON[marker.mode] ?? Route;
  return MapPin;
}

export { directionsUrl } from "@/shared/utils/mapsLinks";

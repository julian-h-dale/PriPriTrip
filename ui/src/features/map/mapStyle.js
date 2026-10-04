import { BedDouble, MapPin, NotebookPen, Route } from "lucide-react";
import { MODE_ICON } from "@/features/timeline/describeEntry";

// A plain emoji glyph per kind/mode — simple, legible on a small pin, no
// per-icon SVG to hand-build for a non-React marker. Easy to swap for a real
// icon later if that's worth it (see ui_review.md §6).
const TRAVEL_GLYPH = { flight: "✈️", train: "🚆", bus: "🚌", ferry: "🚢", boat: "🚢", car: "🚗", other: "🧭" };

export function glyphFor(marker) {
  if (marker.kind === "memory") return "✎";
  if (marker.kind === "stay") return "🏨";
  if (marker.kind === "travel") return TRAVEL_GLYPH[marker.mode] ?? "🧭";
  return "📍";
}

export function colorFor(marker) {
  if (marker.kind === "memory") return "#d65a8c"; // --series-5, memories
  if (marker.kind === "stay") return "#3987e5"; // --series-1
  if (marker.kind === "travel") return "#d95926"; // --series-2
  return "#9085e9"; // --series-7, activities
}

/** The same kinds as the pins' emoji, as real icons for React-rendered lists. */
export function iconFor(marker) {
  if (marker.kind === "memory") return NotebookPen;
  if (marker.kind === "stay") return BedDouble;
  if (marker.kind === "travel") return MODE_ICON[marker.mode] ?? Route;
  return MapPin;
}

export { directionsUrl } from "@/shared/utils/mapsLinks";

/**
 * Each person's color in the journal (Run stage 26): the trip's categorical
 * series colors, handed out in the trip's order of people — the owner first,
 * then members in the order they joined (`authorRank`, from the server). Two
 * people on one trip never share a color, and yours stays put.
 *
 * The class names are written out in full so Tailwind keeps them.
 */
const DOT = ["bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4", "bg-series-5", "bg-series-6", "bg-series-7", "bg-series-8"];
const EDGE = [
  "border-l-series-1",
  "border-l-series-2",
  "border-l-series-3",
  "border-l-series-4",
  "border-l-series-5",
  "border-l-series-6",
  "border-l-series-7",
  "border-l-series-8",
];
const TINT = [
  "bg-series-1/10",
  "bg-series-2/10",
  "bg-series-3/10",
  "bg-series-4/10",
  "bg-series-5/10",
  "bg-series-6/10",
  "bg-series-7/10",
  "bg-series-8/10",
];

export const authorKey = (memory) => (memory.mine ? "me" : memory.authorEmail);

/**
 * { key -> { rank, label, dot, edge, tint } } for the journal's authors, in
 * rank order. A memory of yours still on the phone has no rank yet: it takes
 * the one your saved memories have, else the owner's (0) when you own the
 * trip, else the next free one.
 */
export function authorStyles(memories, trip) {
  const ranks = new Map();
  const labels = new Map();
  for (const memory of memories) {
    const key = authorKey(memory);
    labels.set(key, memory.mine ? "You" : memory.authorName || memory.authorEmail);
    if (memory.authorRank != null && !memory.pending && !ranks.has(key)) ranks.set(key, memory.authorRank);
  }
  if (labels.has("me") && !ranks.has("me")) {
    ranks.set("me", trip?.role === "owner" ? 0 : Math.max(0, ...ranks.values()) + 1);
  }
  for (const key of labels.keys()) if (!ranks.has(key)) ranks.set(key, Math.max(-1, ...ranks.values()) + 1);
  const styles = new Map();
  for (const [key, rank] of [...ranks].sort((a, b) => a[1] - b[1])) {
    const i = rank % DOT.length;
    styles.set(key, { rank, label: labels.get(key), dot: DOT[i], edge: EDGE[i], tint: TINT[i] });
  }
  return styles;
}

export const FALLBACK_STYLE = { rank: 0, label: "", dot: "bg-muted-foreground/40", edge: "border-l-border", tint: "bg-card" };

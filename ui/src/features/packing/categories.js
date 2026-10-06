import { Backpack, Bath, Package, Pill, Plug, Shirt, Sun, Wallet } from "lucide-react";

/** The packing lists, in the order they show (the server's CATEGORIES). */
export const CATEGORIES = [
  { key: "clothes", label: "Clothes", icon: Shirt },
  { key: "toiletries", label: "Toiletries", icon: Bath },
  { key: "electronics", label: "Electronics", icon: Plug },
  { key: "documents", label: "Documents & money", icon: Wallet },
  { key: "health", label: "Health & meds", icon: Pill },
  { key: "outdoors", label: "Beach & outdoors", icon: Sun },
  { key: "carry_on", label: "Carry-on", icon: Backpack },
  { key: "other", label: "Other", icon: Package },
];

/** Items grouped by list, each list in position order: { clothes: [...], ... }. */
export function groupByCategory(items) {
  const groups = Object.fromEntries(CATEGORIES.map((c) => [c.key, []]));
  for (const item of items) (groups[item.category] ?? groups.other).push(item);
  for (const list of Object.values(groups)) list.sort((a, b) => a.position - b.position);
  return groups;
}

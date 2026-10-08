import { useSyncExternalStore } from "react";

/**
 * Text size (Run stage 22): Normal, Large or Larger, a choice for this phone
 * from the All trips drawer, next to Light mode. It sets the root font size,
 * and the app is sized in rem, so the type, the spacing and the timeline's
 * rails and dots all grow together (the dot stays on its date). index.html
 * applies the saved choice before the first paint.
 */
const KEY = "textSize";
export const TEXT_SIZES = [
  { key: "normal", label: "Normal", percent: "100%" },
  { key: "large", label: "Large", percent: "112.5%" },
  { key: "larger", label: "Larger", percent: "125%" },
];

function read() {
  try {
    const saved = localStorage.getItem(KEY);
    return TEXT_SIZES.some((s) => s.key === saved) ? saved : "normal";
  } catch {
    return "normal";
  }
}

const listeners = new Set();

export function applyTextSize(key) {
  const size = TEXT_SIZES.find((s) => s.key === key) ?? TEXT_SIZES[0];
  document.documentElement.style.fontSize = size.key === "normal" ? "" : size.percent;
}

export function setTextSize(key) {
  try {
    if (key === "normal") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, key);
  } catch {
    // Private mode: it lasts until the app closes.
  }
  applyTextSize(key);
  listeners.forEach((l) => l());
}

/** The current text size, re-rendering when it changes. */
export function useTextSize() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "normal",
  );
}

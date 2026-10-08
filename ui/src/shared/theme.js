import { useSyncExternalStore } from "react";

/**
 * Light or dark (Run stage 22): a choice for this phone, from the All trips
 * drawer. Dark is the default. index.html applies the saved choice before the
 * first paint (so the app never flashes dark first); this module changes it
 * afterwards: the class on <html> that selects the colour tokens
 * (index.css), and the status bar's colour (theme-color).
 */
const KEY = "theme";
export const THEME_COLOR = { dark: "#12151c", light: "#f8f9fb" };

function read() {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

const listeners = new Set();

export function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme !== "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

export function setTheme(theme) {
  try {
    if (theme === "light") localStorage.setItem(KEY, "light");
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: it lasts until the app closes.
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

/** The current theme, re-rendering when it changes. */
export function useTheme() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "dark",
  );
}

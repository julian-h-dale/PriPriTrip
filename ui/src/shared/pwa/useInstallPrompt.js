import { useEffect, useState } from "react";

/** True when running as the installed app rather than in a browser tab. */
export function isStandalone(win = window) {
  return Boolean(win.matchMedia?.("(display-mode: standalone)").matches || win.navigator.standalone);
}

/** iPhone/iPad Safari: no install prompt exists, only Share → Add to Home Screen. */
export function isIos(win = window) {
  const ua = win.navigator.userAgent || "";
  // iPadOS reports itself as a Mac; touch support tells them apart.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && win.navigator.maxTouchPoints > 1);
}

/**
 * How this browser can install the app:
 *   { mode: "prompt", install } — Chrome/Android fired beforeinstallprompt
 *   { mode: "ios" }             — show the Share → Add to Home Screen hint
 *   { mode: null }              — already installed, or not installable here
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    function onPrompt(e) {
      e.preventDefault(); // keep it for our own button
      setDeferred(e);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return { mode: null };
  if (deferred) {
    return {
      mode: "prompt",
      async install() {
        deferred.prompt();
        await deferred.userChoice.catch(() => null);
        setDeferred(null); // a prompt can only be used once
      },
    };
  }
  if (isIos()) return { mode: "ios" };
  return { mode: null };
}

import { useEffect, useRef, useState } from "react";

/** How far the finger travels past the edge before letting go moves (Q-S3). */
export const PULL_THRESHOLD_PX = 80;
// Movement before deciding what a touch is: a scroll, a pull, or sideways.
const DECIDE_PX = 8;

/**
 * Whether a finger moving `dy` (down positive) on a scroller at this position
 * pulls past one of its ends: "prev" (at the top, pulling down), "next" (at
 * the bottom, pulling up), or null (an ordinary scroll). A page shorter than
 * the screen is at both ends.
 */
export function pullDirection({ dy, scrollTop, scrollHeight, clientHeight, hasPrev, hasNext }) {
  if (dy > 0 && hasPrev && scrollTop <= 0) return "prev";
  if (dy < 0 && hasNext && scrollTop + clientHeight >= scrollHeight - 1) return "next";
  return null;
}

/** How far the content follows the finger: less and less, so it feels held. */
export function pullOffset(distance) {
  if (distance <= 0) return 0;
  return Math.round(Math.min(distance, PULL_THRESHOLD_PX * 2) * 0.5);
}

/**
 * Pull past the top or bottom of the page to go to the previous or next
 * entry (Run stage 14). Watches touches on `rootRef`'s scroll root
 * (`[data-scroll-root]`), and only takes over once it's already at an end
 * and the finger keeps going: until then the browser scrolls as usual.
 * Letting go past PULL_THRESHOLD_PX calls `onPrev` / `onNext`; short of it,
 * the page springs back.
 *
 * Returns `{ dir, distance }` while pulling (dir null otherwise), for the
 * page to follow the finger and say what letting go will do.
 * Off while a dialog is open, and with more than one finger (a pinch).
 */
export function useEdgePull(rootRef, { hasPrev, hasNext, onPrev, onNext }) {
  const [pull, setPull] = useState({ dir: null, distance: 0 });
  // Read by the listeners, which outlive a render.
  const latest = useRef({});
  latest.current = { hasPrev, hasNext, onPrev, onNext };

  useEffect(() => {
    const root = rootRef.current?.closest("[data-scroll-root]");
    if (!root) return undefined;
    // Pulling at an end mustn't scroll or refresh the page behind (Android's
    // pull-to-refresh, iOS chaining the bounce).
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";

    let touch = null; // { startX, startY, lastY, state: "undecided" | "scroll" | "pull", dir, originY }

    function reset() {
      touch = null;
      setPull({ dir: null, distance: 0 });
    }

    function onStart(e) {
      if (e.touches.length !== 1 || document.querySelector('[role="dialog"]')) {
        touch = null;
        return;
      }
      const { clientX, clientY } = e.touches[0];
      touch = { startX: clientX, startY: clientY, lastY: clientY, state: "undecided", dir: null, originY: 0 };
    }

    function onMove(e) {
      if (!touch) return;
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      const { clientX, clientY } = e.touches[0];
      const step = clientY - touch.lastY;
      touch.lastY = clientY;

      if (touch.state === "undecided") {
        const dx = clientX - touch.startX;
        const dy = clientY - touch.startY;
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        // Sideways first: not ours, for the whole touch.
        touch.state = Math.abs(dx) > Math.abs(dy) ? "sideways" : "scroll";
      }
      if (touch.state === "sideways") return;

      if (touch.state === "scroll") {
        // Scrolled to an end and still going: the pull starts from here.
        const { hasPrev: p, hasNext: n } = latest.current;
        const dir = pullDirection({ dy: step, scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, hasPrev: p, hasNext: n });
        if (!dir) return;
        touch.state = "pull";
        touch.dir = dir;
        touch.originY = clientY - step;
      }

      const distance = touch.dir === "prev" ? clientY - touch.originY : touch.originY - clientY;
      if (distance <= 0) {
        // Back past where it started: an ordinary scroll again.
        touch.state = "scroll";
        touch.dir = null;
        setPull({ dir: null, distance: 0 });
        return;
      }
      if (e.cancelable) e.preventDefault();
      setPull({ dir: touch.dir, distance });
    }

    function onEnd() {
      if (touch?.state === "pull") {
        const distance = touch.dir === "prev" ? touch.lastY - touch.originY : touch.originY - touch.lastY;
        if (distance >= PULL_THRESHOLD_PX) {
          const { onPrev: prev, onNext: next } = latest.current;
          (touch.dir === "prev" ? prev : next)?.();
        }
      }
      reset();
    }

    root.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: a pull stops the browser's own scroll and bounce.
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", reset);
    return () => {
      root.style.overscrollBehaviorY = before;
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", reset);
    };
  }, [rootRef]);

  return pull;
}

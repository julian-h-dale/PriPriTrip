import { useEffect, useState } from "react";

/**
 * "Now" (ms since the epoch) that moves on every `intervalMs` while the
 * component is mounted: one timer for everything on the page that depends
 * on the time (countdowns, clocks, entries greying out).
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

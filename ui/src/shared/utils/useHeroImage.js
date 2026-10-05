import { useEffect, useState } from "react";

/**
 * The photo for a hero fade (shared/components/ui/hero-fade.jsx), or null once
 * it has failed to load — photos are Google-hosted and not cached offline — so
 * the caller drops the room it made for the photo and shows the plain panel.
 */
export function useHeroImage(src) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return { hero: src && !failed ? src : null, onError: () => setFailed(true) };
}

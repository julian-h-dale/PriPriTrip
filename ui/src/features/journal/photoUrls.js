import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { appConfig } from "@/shared/config/appConfig";
import { selectSavedOnly } from "@/shared/networkSlice";

/**
 * Where to load a photo from. Uploaded photos have API paths
 * ("/photos/<id>/thumb") served without login (the id is the secret);
 * photos still waiting in the outbox have blob: URLs from the phone's copy.
 */
export function photoSrc(url) {
  if (!url) return null;
  return /^(blob:|https?:)/.test(url) ? url : `${appConfig.apiBaseUrl}${url}`;
}

/**
 * `photoSrc`, except with "Use saved copies only" on (Run stage 20): then a
 * photo shows only if the phone already has it (the service worker's cache
 * of thumbnails and display copies), read from there, so nothing loads over
 * the network. Null until found, or if it isn't saved.
 */
export function usePhotoSrc(url) {
  const savedOnly = useSelector(selectSavedOnly);
  const src = photoSrc(url);
  const fromNetwork = !src || src.startsWith("blob:");
  const [saved, setSaved] = useState(null); // { src, objectUrl }

  useEffect(() => {
    if (!savedOnly || fromNetwork) return undefined;
    let live = true;
    let objectUrl = null;
    (async () => {
      try {
        const hit = typeof caches !== "undefined" ? await caches.match(src) : null;
        if (!hit || !live) return;
        objectUrl = URL.createObjectURL(await hit.blob());
        if (live) setSaved({ src, objectUrl });
      } catch {
        // Not saved: the placeholder stays.
      }
    })();
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [savedOnly, src, fromNetwork]);

  if (!savedOnly || fromNetwork) return src;
  return saved?.src === src ? saved.objectUrl : null;
}

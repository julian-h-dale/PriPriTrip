import { appConfig } from "@/shared/config/appConfig";

/**
 * Where to load a photo from. Uploaded photos have API paths
 * ("/photos/<id>/thumb") served without login (the id is the secret);
 * photos still waiting in the outbox have blob: URLs from the phone's copy.
 */
export function photoSrc(url) {
  if (!url) return null;
  return /^(blob:|https?:)/.test(url) ? url : `${appConfig.apiBaseUrl}${url}`;
}

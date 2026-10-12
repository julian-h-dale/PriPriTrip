/** Trip settings helpers (Run stage 29). */

/** Whether a trip has a cover to show (Run stage 29). */
export const hasCover = (trip) => Boolean(trip?.coverEmoji || trip?.coverThumbUrl);

/** Emoji to pick a cover from; any other can be typed. */
export const COVER_EMOJI = ["🏔️", "🏖️", "🏝️", "🏙️", "🏛️", "🏰", "⛩️", "🗼", "🌋", "🏕️", "✈️", "🚆", "⛵", "🚗", "🎿", "🍷", "🍝", "🍣", "🌸", "☀️", "❄️", "🎉", "❤️", "🌍"];

/** The file name the export saves as, like the server's own: "bern-wengen.json". */
export function exportFilename(name) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trip"}.json`;
}

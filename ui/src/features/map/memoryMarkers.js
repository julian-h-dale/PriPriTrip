import { memoryDate, memoryTime } from "@/features/journal/journalDays";

/**
 * Journal memories that carry a location, as map markers (kind "memory").
 * Their `day` is the date they were written where they were written, so
 * the map's Calendar filter treats them like everything else.
 */
export function memoryMarkers(memories) {
  return memories
    .filter((m) => m.location)
    .map((m) => ({
      id: `memory-${m.id}`,
      kind: "memory",
      mode: null,
      lat: m.location.lat,
      lng: m.location.lng,
      title: m.text.length > 60 ? `${m.text.slice(0, 57)}…` : m.text,
      text: m.text,
      city: null,
      imgRef: null,
      day: memoryDate(m),
      endDay: null,
      time: memoryTime(m),
      author: m.mine ? "You" : m.authorEmail,
    }));
}

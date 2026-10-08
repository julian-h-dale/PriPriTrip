import { buildTimeline } from "@/features/timeline/buildTimeline";
import { describeEntry, MODE_LABEL } from "@/features/timeline/describeEntry";
import { formatTime } from "@/shared/utils/time";

/**
 * Search the whole trip on the device (so it works offline): every entry's
 * title, notes, confirmation number, carrier and number, seat or room, and
 * its places' names, cities and addresses — plus each day's own title and
 * summary. Case- and accent-insensitive ("zurich" finds "Zürich").
 *
 * A booking is listed once, where it starts (a stay at its check-in, a leg at
 * its departure), not on every date it touches.
 *
 * Returns days in trip order: [{ date, day: matchedDayText | null, results:
 * [{ key, entry, title, subtitle, detail, where }] }], where `detail` is the
 * time and place in the timeline's words ("10:00 AM · Varvakios Central
 * Market") and `where` names the field that matched when it isn't the title
 * ("Confirmation: LX7Q2K").
 */

export function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function placeFields(label, loc) {
  if (!loc) return [];
  return [
    [label, loc.name],
    [label, loc.city],
    [label, loc.address],
  ];
}

/** [label, text] pairs to search for one entry; the first is its title. */
function fieldsOf(entry, d) {
  if (entry.kind === "activity") {
    const { item } = entry;
    return [
      [null, d.title],
      ["Confirmation", item.confirmationNumber],
      ["Notes", item.notes],
      ...placeFields("Where", item.location),
    ];
  }
  if (entry.kind === "stay") {
    const { stay } = entry;
    return [
      [null, stay.name],
      ["Confirmation", stay.confirmationNumber],
      ["Room", stay.roomType],
      ["Notes", stay.notes],
      ...placeFields("Where", stay.location),
    ];
  }
  const { travel } = entry;
  return [
    [null, travel.title],
    ["Confirmation", travel.confirmationNumber],
    [MODE_LABEL[travel.mode] ?? "Travel", [travel.carrier, travel.number].filter(Boolean).join(" ")],
    ["Seat", travel.seat],
    ["Notes", travel.notes],
    ...placeFields("From", travel.from),
    ...placeFields("To", travel.to),
  ];
}

/**
 * A result's second line: its time (shown as written: a wall-clock value),
 * then where — an activity's place, a stay's city, a leg's carrier and
 * number. Either alone when that's all there is.
 */
function detailOf(entry, d) {
  const time = d.start && d.start.length > 10 ? formatTime(d.start) : null;
  let place = null;
  if (entry.kind === "activity") place = entry.item.location?.name ?? entry.item.location?.city ?? null;
  else if (entry.kind === "stay") place = entry.stay.location?.city ?? null;
  else place = [entry.travel.carrier, entry.travel.number].filter(Boolean).join(" ") || null;
  return [time, place].filter(Boolean).join(" · ") || null;
}

/** Notes are markdown; a snippet shows the words, not the markup. */
function plain(text) {
  return String(text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) -> label
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ");
}

/** A short stretch of `text` around the match, for showing where it hit. */
function snippet(text, at, length) {
  const flat = String(text).replace(/\s+/g, " ");
  if (flat.length <= 60) return flat;
  const start = Math.max(0, at - 20);
  const end = Math.min(flat.length, at + length + 30);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Whether every word of the query appears somewhere in the given texts. */
function matchesAll(words, texts) {
  const hay = texts.map(normalize).join("\n");
  return words.every((w) => hay.includes(w));
}

export function searchTrip(trip, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const daysByDate = new Map((trip.days ?? []).map((day) => [day.date, day]));
  const groups = [];

  for (const row of buildTimeline(trip)) {
    const results = [];
    for (const entry of row.entries) {
      // One result per booking: where it starts.
      if (entry.kind === "stay" && entry.phase !== "check-in") continue;
      if (entry.kind === "travel" && entry.phase !== "depart") continue;
      const d = describeEntry(entry, trip);
      const fields = fieldsOf(entry, d).filter(([, text]) => text);
      if (!matchesAll(words, fields.map(([, text]) => text))) continue;
      // Say which field matched, unless the title did.
      const titleHit = words.some((w) => normalize(fields[0][1]).includes(w));
      let where = null;
      if (!titleHit) {
        for (const [label, raw] of fields.slice(1)) {
          const text = plain(raw);
          const at = normalize(text).indexOf(words[0]);
          if (at !== -1) {
            where = `${label}: ${snippet(text, at, words[0].length)}`;
            break;
          }
        }
      }
      results.push({ key: entry.key, entry, title: d.title, subtitle: d.subtitle, detail: detailOf(entry, d), where });
    }

    const day = daysByDate.get(row.date);
    const dayText = [day?.title, day?.summary].filter(Boolean).join(" — ");
    const dayHit = dayText && matchesAll(words, [dayText]) ? dayText : null;
    if (results.length || dayHit) groups.push({ date: row.date, day: dayHit, results });
  }
  return groups;
}

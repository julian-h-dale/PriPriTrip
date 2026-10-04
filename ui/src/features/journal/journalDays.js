import { todayIn } from "@/shared/utils/tripDates";

/**
 * Group a trip's memories for the journal. A memory belongs to the calendar
 * date it was written on *where it was written* — its own zone — so a note
 * at 00:30 in Tokyo is that Tokyo date, whatever the date in UTC or on the
 * phone reading it. Memories before the trip's first day or after its last
 * go in their own groups. Inside a group, the server's order (UTC creation
 * time) is kept.
 *
 *   [{ key, kind: "before" | "day" | "after", date?, memories }]
 */
export function memoryDate(memory) {
  return todayIn(memory.zone, new Date(memory.createdAt));
}

export function journalDays(memories, trip) {
  const before = [];
  const after = [];
  const byDate = new Map();
  for (const memory of memories) {
    const date = memoryDate(memory);
    if (date < trip.startDate) before.push(memory);
    else if (date > trip.endDate) after.push(memory);
    else {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(memory);
    }
  }
  const groups = [];
  if (before.length) groups.push({ key: "before", kind: "before", memories: before });
  for (const date of [...byDate.keys()].sort()) {
    groups.push({ key: date, kind: "day", date, memories: byDate.get(date) });
  }
  if (after.length) groups.push({ key: "after", kind: "after", memories: after });
  return groups;
}

/** "8:14 PM" — a memory's time on the clock where it was written. */
export function memoryTime(memory) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: memory.zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(memory.createdAt));
}

/** The phone's own IANA zone right now (sent with a new memory). */
export function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

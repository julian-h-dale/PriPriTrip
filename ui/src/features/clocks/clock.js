/**
 * A digital clock's readings for an instant in a zone, with Intl (no
 * library): the phone knows every zone's rules, offline too.
 */

const timeParts = new Map();
const dateFormat = new Map();

function cached(map, zone, make) {
  if (!map.has(zone)) map.set(zone, make());
  return map.get(zone);
}

/** { time: "3:24", seconds: "07", period: "PM", hour24: 15, date: "Tue, Oct 6" }. */
export function readClock(zone, now) {
  const parts = cached(timeParts, zone, () =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
  ).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour24 = Number(get("hour")) % 24;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    time: `${hour12}:${get("minute")}`,
    seconds: get("second"),
    period: hour24 < 12 ? "AM" : "PM",
    hour24,
    date: cached(dateFormat, zone, () =>
      new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" })
    ).format(now),
  };
}

/** The zone's offset from UTC at `now`, in minutes (Tokyo: 540). */
export function offsetMinutes(zone, now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, Number(value)])
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  const whole = Math.floor(now.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - whole) / 60_000);
}

/** "UTC+9", "UTC−5", "UTC+5:30". */
export function formatUtcOffset(minutes) {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const m = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** How a zone compares with the phone, from the difference in minutes:
 * "14 hours ahead", "5 h 30 min behind", "Same time as you". */
export function compareToPhone(minutes) {
  if (minutes === 0) return "Same time as you";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = m ? `${h ? `${h} h ` : ""}${m} min` : `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${amount} ${minutes > 0 ? "ahead" : "behind"}`;
}

/** The phone's own zone: where you are now. */
export function phoneZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

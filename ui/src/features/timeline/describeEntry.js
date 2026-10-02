import {
  BedDouble,
  Bus,
  Car,
  Compass,
  DoorOpen,
  KeyRound,
  MapPin,
  Plane,
  PlaneLanding,
  Route,
  Ship,
  TrainFront,
} from "lucide-react";
import { formatDayHeading, formatTime, zoneLabel } from "@/shared/utils/time";

/**
 * Presentation for one timeline entry: icon, title, times, and the details
 * shown when it expands. Pure — no React state — so it is easy to test.
 */

const MODE_ICON = { flight: Plane, train: TrainFront, bus: Bus, ferry: Ship, car: Car, other: Route };
const MODE_LABEL = { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry", car: "Car", other: "Travel" };

function carrierLine(travel) {
  return [travel.carrier, travel.number].filter(Boolean).join(" ") || null;
}

/** Everything the row needs, derived from one timeline entry. */
export function describeEntry(entry, trip) {
  const tripZone = trip.timezone;
  if (entry.kind === "activity") {
    const { item } = entry;
    return {
      icon: item.location ? MapPin : Compass,
      title: item.title,
      subtitle: item.location?.name ?? null,
      start: item.start ?? null,
      end: item.end ?? null,
      // Zones come from the server (app/zones.py: place, else night’s stay, else trip).
      zone: item.zone ?? item.timezone ?? tripZone,
      notes: item.notes,
      confirmation: item.confirmationNumber,
      locations: item.location ? [{ label: "Where", loc: item.location }] : [],
      facts: [],
    };
  }

  if (entry.kind === "stay") {
    const { stay, phase } = entry;
    const zone = stay.zone ?? stay.timezone ?? tripZone;
    const title =
      phase === "check-in"
        ? `Check in · ${stay.name}`
        : phase === "check-out"
          ? `Check out · ${stay.name}`
          : `Staying at ${stay.name}`;
    return {
      icon: phase === "check-in" ? KeyRound : phase === "check-out" ? DoorOpen : BedDouble,
      title,
      subtitle: stay.location && stay.location.name !== stay.name ? stay.location.name : null,
      start: phase === "check-in" ? stay.checkIn : phase === "check-out" ? stay.checkOut : null,
      end: null,
      zone,
      muted: phase === "staying",
      notes: stay.notes,
      confirmation: stay.confirmationNumber,
      locations: stay.location ? [{ label: "Where", loc: stay.location }] : [],
      facts: [
        ["Check-in", fullTime(stay.checkIn, zone, tripZone)],
        ["Check-out", fullTime(stay.checkOut, zone, tripZone)],
      ],
    };
  }

  const { travel, phase, overnight } = entry;
  const departZone = travel.departZone ?? travel.departTimezone ?? tripZone;
  const arriveZone = travel.arriveZone ?? travel.arriveTimezone ?? tripZone;
  const carrier = carrierLine(travel);
  const arriving = phase === "arrive";
  let subtitle = carrier;
  if (!arriving && overnight) {
    subtitle = [carrier, `arrives ${formatDayHeading(travel.arrive)}`].filter(Boolean).join(" · ");
  }
  return {
    icon: arriving ? (travel.mode === "flight" ? PlaneLanding : MODE_ICON[travel.mode]) : MODE_ICON[travel.mode] ?? Route,
    title: arriving ? `Arrive · ${travel.to?.name ?? travel.title}` : travel.title,
    subtitle: arriving ? [travel.title, carrier].filter(Boolean).join(" · ") : subtitle,
    start: arriving ? travel.arrive : travel.depart,
    // A same-day leg shows its whole span; an overnight one shows each end on its own date.
    end: !arriving && !overnight ? (travel.arrive ?? null) : null,
    zone: arriving ? arriveZone : departZone,
    // Until a leg has both an arrival place and time, the timeline can't show
    // when you land — say so on the departure.
    warning: !arriving && (!travel.arrive || !travel.to) ? "No arrival yet" : null,
    endZone: arriveZone,
    notes: travel.notes,
    confirmation: travel.confirmationNumber,
    locations: [
      travel.from && { label: "From", loc: travel.from },
      travel.to && { label: "To", loc: travel.to },
    ].filter(Boolean),
    facts: [
      [MODE_LABEL[travel.mode] ?? "Travel", carrier],
      ["Departs", fullTime(travel.depart, departZone, tripZone)],
      ["Arrives", travel.arrive ? fullTime(travel.arrive, arriveZone, tripZone) : null],
    ].filter(([, value]) => value),
  };
}

function fullTime(wallClock, zone, tripZone) {
  const base = `${formatDayHeading(wallClock)} · ${formatTime(wallClock)}`;
  return zone === tripZone ? base : `${base} (${zoneLabel(zone)})`;
}

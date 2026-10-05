import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describeEntry } from "@/features/timeline/describeEntry";
import { EntryDetails } from "@/features/timeline/EntryDetails";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";

const TRIP = { timezone: "Asia/Tokyo" };
const PHOTO = "https://example.com/photo.jpg";

const stay = {
  name: "Hotel Royal",
  checkIn: "2026-10-30T15:00",
  checkOut: "2026-11-02T11:00",
  roomType: "Twin, ocean view",
  confirmationNumber: "HR-123",
  notes: "Breakfast **included**",
  location: { name: "Hotel Royal", address: "Naha, Okinawa", lat: 26.2, lng: 127.7, imgRef: PHOTO },
};
const flight = {
  mode: "flight",
  title: "Chicago → Taipei",
  carrier: "EVA Air",
  number: "BR55",
  seat: "42A",
  depart: "2026-10-29T00:30",
  arrive: "2026-10-30T05:20",
  confirmationNumber: "DAAL7X",
  notes: "Check in online",
  from: { name: "O'Hare (ORD)", lat: 41.97, lng: -87.9, imgRef: PHOTO },
  to: { name: "Taoyuan (TPE)", lat: 25.07, lng: 121.23, imgRef: PHOTO },
};

function order(container) {
  // Facts, then confirmation, then notes, then places — by document position.
  const pos = (node) => [...container.querySelectorAll("*")].indexOf(node);
  return {
    facts: pos(container.querySelector("dl")),
    confirmation: pos(screen.getByText("Confirmation")),
    notes: pos(screen.getByText(/included|online/)),
    place: pos(screen.getAllByText(/^(Where|From)$/)[0]),
  };
}

describe("EntryDetails", () => {
  it("a stay: facts (with the room), confirmation, notes, then the place", () => {
    const d = describeEntry({ kind: "stay", phase: "check-in", stay }, TRIP);
    const { container } = render(<EntryDetails d={d} />);
    expect(screen.getByText("Room").nextSibling).toHaveTextContent("Twin, ocean view");
    const o = order(container);
    expect(o.facts).toBeLessThan(o.confirmation);
    expect(o.confirmation).toBeLessThan(o.notes);
    expect(o.notes).toBeLessThan(o.place);
    expect(container.querySelector("img")).toBeNull(); // the photo is the hero, not here
  });

  it("a flight: the seat in the facts", () => {
    const d = describeEntry({ kind: "travel", phase: "depart", travel: flight, overnight: true }, TRIP);
    const { container } = render(<EntryDetails d={d} />);
    expect(screen.getByText("Seat").nextSibling).toHaveTextContent("42A");
    expect(screen.getByText("O'Hare (ORD)")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    const o = order(container);
    expect(o.confirmation).toBeLessThan(o.place);
  });
});

describe("the hero photo", () => {
  const activity = { title: "Shuri Castle", location: { name: "Shuri Castle", imgRef: PHOTO } };

  it("is the place's photo for a stay or an activity, and a leg's destination else its origin", () => {
    expect(describeEntry({ kind: "stay", phase: "check-in", stay }, TRIP).hero).toBe(PHOTO);
    expect(describeEntry({ kind: "activity", item: activity }, TRIP).hero).toBe(PHOTO);
    const to = { ...flight.to, imgRef: "https://example.com/to.jpg" };
    const leg = (extra) => ({ kind: "travel", phase: "depart", travel: { ...flight, ...extra }, overnight: true });
    expect(describeEntry(leg({ to }), TRIP).hero).toBe("https://example.com/to.jpg");
    expect(describeEntry(leg({ to: { ...to, imgRef: undefined } }), TRIP).hero).toBe(PHOTO);
    expect(describeEntry({ kind: "activity", item: { title: "Walk" } }, TRIP).hero).toBeNull();
  });

  function row(entry) {
    return render(
      <ul>
        <TimelineEntry entry={{ ...entry, key: "k" }} trip={TRIP} expanded onToggle={() => {}} />
      </ul>
    );
  }

  it("fades in behind an expanded row, as in the details dialog", () => {
    row({ kind: "stay", phase: "check-in", stay });
    expect(screen.getByTestId("hero-fade")).toHaveAttribute("src", PHOTO);
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("an expanded flight gets one too (the same for every kind of entry)", () => {
    row({ kind: "travel", phase: "depart", travel: flight, overnight: true });
    expect(screen.getByTestId("hero-fade")).toHaveAttribute("src", PHOTO);
  });

  it("is dropped, with its room, when the photo can't load", () => {
    const { container } = row({ kind: "stay", phase: "check-in", stay });
    expect(container.querySelector(".pt-28")).not.toBeNull();
    fireEvent.error(screen.getByTestId("hero-fade"));
    expect(screen.queryByTestId("hero-fade")).not.toBeInTheDocument();
    expect(container.querySelector(".pt-28")).toBeNull();
    expect(screen.getByText("HR-123")).toBeInTheDocument();
  });

  it("is absent without a photo", () => {
    row({ kind: "activity", item: { title: "Walk", notes: "Easy" } });
    expect(screen.queryByTestId("hero-fade")).not.toBeInTheDocument();
  });
});

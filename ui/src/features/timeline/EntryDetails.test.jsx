import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { describeEntry } from "@/features/timeline/describeEntry";
import { EntryDetails } from "@/features/timeline/EntryDetails";

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
  it("a stay: facts (with the room), confirmation, notes, then the place with a small photo", () => {
    const d = describeEntry({ kind: "stay", phase: "check-in", stay }, TRIP);
    const { container } = render(<EntryDetails d={d} />);
    expect(screen.getByText("Room").nextSibling).toHaveTextContent("Twin, ocean view");
    const o = order(container);
    expect(o.facts).toBeLessThan(o.confirmation);
    expect(o.confirmation).toBeLessThan(o.notes);
    expect(o.notes).toBeLessThan(o.place);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", PHOTO);
    expect(img).toHaveClass("h-16", "w-16"); // a thumbnail, not a banner
  });

  it("a flight: the seat in the facts, and no airport photos", () => {
    const d = describeEntry({ kind: "travel", phase: "depart", travel: flight, overnight: true }, TRIP);
    const { container } = render(<EntryDetails d={d} />);
    expect(screen.getByText("Seat").nextSibling).toHaveTextContent("42A");
    expect(screen.getByText("O'Hare (ORD)")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    const o = order(container);
    expect(o.confirmation).toBeLessThan(o.place);
  });
});

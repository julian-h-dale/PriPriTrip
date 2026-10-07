import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntryView } from "@/features/entry/EntryPage";
import { describeEntry } from "@/features/timeline/describeEntry";

const TRIP = { id: "t", timezone: "Asia/Tokyo" };
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

function view(found) {
  return render(<EntryView trip={TRIP} found={{ date: "2026-10-30", ...found }} />);
}

/** Where things sit on the page, by document position. */
function order(container) {
  const pos = (node) => [...container.querySelectorAll("*")].indexOf(node);
  return {
    confirmation: pos(screen.getByText("Confirmation")),
    when: pos(screen.getByRole("region", { name: "When" })),
    facts: pos(container.querySelector("dl")),
    notes: pos(screen.getByRole("region", { name: "Notes" })),
    place: pos(screen.getAllByText(/^(Where|From)$/)[0]),
  };
}

describe("the entry page's layout", () => {
  it("a stay: confirmation, when, facts (the room), notes, then the place", () => {
    const { container } = view({ kind: "stay", record: stay });
    expect(screen.getByText("Room").nextSibling).toHaveTextContent("Twin, ocean view");
    const o = order(container);
    expect(o.confirmation).toBeLessThan(o.when);
    expect(o.when).toBeLessThan(o.facts);
    expect(o.facts).toBeLessThan(o.notes);
    expect(o.notes).toBeLessThan(o.place);
  });

  it("a flight: the seat in the facts, both airports", () => {
    view({ kind: "travel", record: flight });
    expect(screen.getByText("Seat").nextSibling).toHaveTextContent("42A");
    expect(screen.getAllByText("O'Hare (ORD)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Taoyuan (TPE)").length).toBeGreaterThan(0);
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

  it("fades into the top of the page", () => {
    view({ kind: "stay", record: stay });
    expect(screen.getByTestId("hero-fade")).toHaveAttribute("src", PHOTO);
  });

  it("is dropped, with its room, when the photo can't load", () => {
    const { container } = view({ kind: "stay", record: stay });
    expect(container.querySelector(".pt-44")).not.toBeNull();
    fireEvent.error(screen.getByTestId("hero-fade"));
    expect(screen.queryByTestId("hero-fade")).not.toBeInTheDocument();
    expect(container.querySelector(".pt-44")).toBeNull();
    expect(screen.getByText("HR-123")).toBeInTheDocument();
  });

  it("is absent without a photo", () => {
    view({ kind: "activity", record: { title: "Walk", notes: "Easy" } });
    expect(screen.queryByTestId("hero-fade")).not.toBeInTheDocument();
  });
});

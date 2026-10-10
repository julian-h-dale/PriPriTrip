import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  return render(
    <MemoryRouter>
      <EntryView trip={TRIP} found={{ date: "2026-10-30", ...found }} />
    </MemoryRouter>
  );
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

describe("nearby points of interest", () => {
  const MUSEUM = { name: "Beitou Hot Spring Museum", lat: 25.1365694, lng: 121.50715, placeId: "museum" };
  const poi = (id, name, lat, lng, category = "sight") => ({ id, name, category, location: { name, lat, lng } });
  const VALLEY = poi("valley", "Thermal Valley", 25.1377, 121.5113);
  const SPRING = poi("spring", "Millennium Hot Spring", 25.1369, 121.5079, "other");
  const FAR = poi("101", "Taipei 101", 25.0339, 121.5645);
  const activity = { id: "a1", title: "Beitou Park, Hot Spring Museum, Thermal Valley", location: MUSEUM };

  function nearbyView(found, pointsOfInterest) {
    return render(
      <MemoryRouter>
        <EntryView trip={{ ...TRIP, pointsOfInterest }} found={{ date: "2026-11-11", ...found }} online={false} />
      </MemoryRouter>
    );
  }

  it("an activity lists them closest first, with the distance, each opening the map at its pin", () => {
    nearbyView({ kind: "activity", record: activity }, [FAR, VALLEY, SPRING]);
    const section = screen.getByRole("region", { name: "Nearby" });
    const links = within(section).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringMatching(/^Millennium Hot SpringOther0\.1 mi$/),
      expect.stringMatching(/^Thermal ValleySight0\.3 mi$/),
    ]);
    expect(links[1]).toHaveAttribute("href", "/trips/t/map?focus=poi-valley");
  });

  it("a stay has them too; travel doesn't", () => {
    const { unmount } = nearbyView({ kind: "stay", record: { ...stay, location: MUSEUM } }, [VALLEY]);
    expect(screen.getByRole("region", { name: "Nearby" })).toBeInTheDocument();
    unmount();
    nearbyView({ kind: "travel", record: { ...flight, to: MUSEUM } }, [VALLEY]);
    expect(screen.queryByRole("region", { name: "Nearby" })).not.toBeInTheDocument();
  });

  it("nothing near, or a place without coordinates: no section", () => {
    const { unmount } = nearbyView({ kind: "activity", record: activity }, [FAR]);
    expect(screen.queryByRole("region", { name: "Nearby" })).not.toBeInTheDocument();
    unmount();
    nearbyView({ kind: "activity", record: { ...activity, location: { name: "Beitou" } } }, [VALLEY]);
    expect(screen.queryByRole("region", { name: "Nearby" })).not.toBeInTheDocument();
  });

  it("shows 8, then Show all", () => {
    const many = Array.from({ length: 10 }, (_, i) => poi(`p${i}`, `Stall ${i}`, MUSEUM.lat + i * 0.0003, MUSEUM.lng, "market"));
    nearbyView({ kind: "activity", record: activity }, many);
    const section = screen.getByRole("region", { name: "Nearby" });
    expect(within(section).getAllByRole("link")).toHaveLength(8);
    fireEvent.click(within(section).getByRole("button", { name: "Show all 10" }));
    expect(within(section).getAllByRole("link")).toHaveLength(10);
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the mini map opens the trip's map at that place", () => {
  const mapLink = (name) => screen.queryByRole("link", { name: `Show ${name} on the map` });

  it("an activity, a stay, and each end of a leg link to their own pin", () => {
    const { unmount } = view({ kind: "activity", record: { id: "a1", title: "Rose garden", location: stay.location } });
    expect(mapLink("Hotel Royal")).toHaveAttribute("href", "/trips/t/map?focus=item-a1");
    unmount();
    const second = view({ kind: "stay", record: { ...stay, id: "s1" } });
    expect(mapLink("Hotel Royal")).toHaveAttribute("href", "/trips/t/map?focus=stay-s1");
    second.unmount();
    view({ kind: "travel", record: { ...flight, id: "l1" } });
    expect(mapLink("O'Hare (ORD)")).toHaveAttribute("href", "/trips/t/map?focus=travel-l1-from");
    expect(mapLink("Taoyuan (TPE)")).toHaveAttribute("href", "/trips/t/map?focus=travel-l1-to");
  });

  it("a plan B activity has no pin, so its map is just a picture", () => {
    view({ kind: "activity", planB: true, record: { id: "b1", title: "Museum", location: stay.location } });
    expect(mapLink("Hotel Royal")).not.toBeInTheDocument();
  });

  it("no link without coordinates, or offline (no map at all)", () => {
    const { unmount } = view({ kind: "stay", record: { ...stay, id: "s1", location: { name: "Hotel Royal" } } });
    expect(mapLink("Hotel Royal")).not.toBeInTheDocument();
    unmount();
    render(
      <MemoryRouter>
        <EntryView trip={TRIP} found={{ date: "2026-10-30", kind: "stay", record: { ...stay, id: "s1" } }} online={false} />
      </MemoryRouter>
    );
    expect(mapLink("Hotel Royal")).not.toBeInTheDocument();
  });
});

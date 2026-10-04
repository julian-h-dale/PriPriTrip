import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MapInfoContent } from "@/features/map/MapInfoContent";

const HOTEL = { placeId: "h1", name: "Hotel Bellevue", address: "Bern", lat: 46.9, lng: 7.4, imgRef: "https://example.com/p.jpg" };

function renderInfo(props) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MapInfoContent tripId="trip-1" onAction={vi.fn()} readOnly={false} {...props} />
    </MemoryRouter>
  );
}

describe("MapInfoContent", () => {
  it("a hotel offers Add stay first, and reports the chosen action", async () => {
    const onAction = vi.fn();
    renderInfo({ info: { kind: "place", place: HOTEL, types: ["lodging"] }, onAction });
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.slice(0, 2)).toEqual(["Add stay", "Add activity"]);
    await userEvent.click(screen.getByRole("button", { name: "Add stay" }));
    expect(onAction).toHaveBeenCalledWith("stay");
  });

  it("Add actions are disabled while read-only", () => {
    renderInfo({ info: { kind: "place", place: HOTEL, types: ["lodging"] }, readOnly: true });
    expect(screen.getByRole("button", { name: "Add stay" })).toBeDisabled();
  });

  it("a trip marker links to its day (in-app) and to directions", () => {
    const marker = { id: "stay-1", kind: "stay", title: "Hotel Goldener Schlüssel", day: "2026-05-11", lat: 46.9, lng: 7.4 };
    renderInfo({ info: { kind: "trip", marker } });
    expect(screen.getByRole("link", { name: "View day" })).toHaveAttribute("href", "/trips/trip-1/days/2026-05-11");
    expect(screen.getByRole("link", { name: "Directions" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=46.9,7.4"
    );
    expect(screen.queryByText("Not in this trip")).not.toBeInTheDocument();
  });
});

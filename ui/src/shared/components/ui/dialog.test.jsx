import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@/shared/components/ui/dialog";
import { BookingDetailsDialog } from "@/features/timeline/BookingDetailsDialog";

const PHOTO = "https://example.com/hotel.jpg";

describe("Dialog hero fade", () => {
  it("shows the photo behind the title, decorative only", () => {
    render(
      <Dialog open onClose={() => {}} title="Hotel Royal" heroImage={PHOTO}>
        <p>details</p>
      </Dialog>
    );
    const hero = screen.getByTestId("dialog-hero");
    expect(hero).toHaveAttribute("src", PHOTO);
    expect(hero).toHaveAttribute("alt", "");
    expect(screen.getByRole("dialog", { name: "Hotel Royal" })).toHaveClass("pt-32");
  });

  it("falls back to the plain dialog when the photo can't load", () => {
    render(
      <Dialog open onClose={() => {}} title="Hotel Royal" heroImage={PHOTO}>
        <p>details</p>
      </Dialog>
    );
    fireEvent.error(screen.getByTestId("dialog-hero"));
    expect(screen.queryByTestId("dialog-hero")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Hotel Royal" })).not.toHaveClass("pt-32");
  });

  it("is the plain dialog without one", () => {
    render(
      <Dialog open onClose={() => {}} title="Plain">
        <p>details</p>
      </Dialog>
    );
    expect(screen.queryByTestId("dialog-hero")).not.toBeInTheDocument();
  });
});

describe("booking quick look", () => {
  const TRIP = { timezone: "Europe/Zurich" };
  const stay = {
    name: "Hotel Royal",
    checkIn: "2026-05-11T14:00",
    checkOut: "2026-05-12T10:00",
    confirmationNumber: "HR-1",
    location: { name: "Hotel Royal", address: "Bern", lat: 46.9, lng: 7.4, imgRef: PHOTO },
  };

  it("a stay's photo is the hero, with no thumbnail repeated below", () => {
    render(<BookingDetailsDialog open onClose={() => {}} onEdit={() => {}} trip={TRIP} kind="stay" record={stay} />);
    expect(screen.getByTestId("dialog-hero")).toHaveAttribute("src", PHOTO);
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByText("HR-1")).toBeInTheDocument();
  });

  it("a flight's hero is its destination's photo, else its departure point's", () => {
    const leg = {
      mode: "flight",
      title: "Chicago → Zürich",
      depart: "2026-05-10T17:40",
      arrive: "2026-05-11T09:25",
      from: { name: "ORD", lat: 41.9, lng: -87.9, imgRef: "https://example.com/ord.jpg" },
      to: { name: "ZRH", lat: 47.4, lng: 8.5, imgRef: "https://example.com/zrh.jpg" },
    };
    const { unmount } = render(
      <BookingDetailsDialog open onClose={() => {}} onEdit={() => {}} trip={TRIP} kind="travel" record={leg} />
    );
    expect(screen.getByTestId("dialog-hero")).toHaveAttribute("src", "https://example.com/zrh.jpg");
    expect(document.querySelectorAll("img")).toHaveLength(1); // no airport thumbnails below
    unmount();

    const noDestinationPhoto = { ...leg, to: { ...leg.to, imgRef: undefined } };
    render(
      <BookingDetailsDialog open onClose={() => {}} onEdit={() => {}} trip={TRIP} kind="travel" record={noDestinationPhoto} />
    );
    expect(screen.getByTestId("dialog-hero")).toHaveAttribute("src", "https://example.com/ord.jpg");
  });
});

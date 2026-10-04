import { describe, it, expect } from "vitest";
import { toFormValues } from "@/features/timeline/activityForm";
import { toStayValues, toTravelValues, travelPayload } from "@/features/timeline/bookingForms";

const TRIP = { startDate: "2026-10-29", endDate: "2026-11-13", timezone: "Asia/Tokyo" };
const HOTEL = { name: "Hotel Royal Okinawa", address: "Naha, Okinawa", city: "Naha", lat: 26.2, lng: 127.7, placeId: "p-hotel" };
const AIRPORT = { name: "Naha Airport", city: "Naha", lat: 26.19, lng: 127.64, placeId: "p-oka" };

describe("prefilled forms (adding from the map)", () => {
  it("a stay starts at the place, named after it", () => {
    const values = toStayValues(null, "2026-10-30", TRIP, { place: HOTEL });
    expect(values.place).toEqual(HOTEL);
    expect(values.name).toBe("Hotel Royal Okinawa");
    expect(values.checkInDate).toBe("2026-10-30");
  });

  it("an activity starts at the place, titled after it", () => {
    const values = toFormValues(null, "2026-10-30", { place: HOTEL });
    expect(values.place).toEqual(HOTEL);
    expect(values.title).toBe("Hotel Royal Okinawa");
    expect(values.date).toBe("2026-10-30");
  });

  it("travel from here: the place is the departure, and the title follows it", () => {
    const values = toTravelValues(null, "2026-11-04", { place: AIRPORT, end: "from" });
    expect(values.from).toEqual(AIRPORT);
    expect(values.to).toBeNull();
    expect(values.title).toBe("From Naha Airport");
    expect(values.titleEdited).toBe(false);
  });

  it("travel to here: the place is the arrival, arriving that day like a picked place", () => {
    const values = toTravelValues(null, "2026-10-29", { place: AIRPORT, end: "to" });
    expect(values.to).toEqual(AIRPORT);
    expect(values.from).toBeNull();
    expect(values.arriveDate).toBe("2026-10-29");
    // Once the departure is picked, the title follows both places.
    const withFrom = { ...values, from: { name: "Chicago O'Hare" }, departTime: "10:00" };
    expect(travelPayload({ ...withFrom, title: "Chicago O'Hare → Naha Airport" }, null).to.name).toBe("Naha Airport");
  });

  it("an existing record ignores a prefill", () => {
    const stay = { name: "Kept", type: "hotel", checkIn: "2026-10-29T15:00", checkOut: "2026-10-30T11:00", location: { name: "Kept" } };
    expect(toStayValues(stay, "2026-10-29", TRIP, { place: HOTEL }).name).toBe("Kept");
  });
});

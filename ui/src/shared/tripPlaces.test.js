import { beforeEach, describe, expect, it } from "vitest";
import { forgetPlaces, rememberPlace, savedPlace } from "@/shared/tripPlaces";

describe("tripPlaces", () => {
  beforeEach(() => {
    forgetPlaces("a");
    forgetPlaces("b");
  });

  it("keeps each trip's and each screen's place apart", () => {
    rememberPlace("timeline", "a", { view: "stays", scrollTop: 300 });
    rememberPlace("timeline", "b", { view: "plan", scrollTop: 10 });
    rememberPlace("map", "a", { zoom: 12 });
    expect(savedPlace("timeline", "a")).toEqual({ view: "stays", scrollTop: 300 });
    expect(savedPlace("timeline", "b")).toEqual({ view: "plan", scrollTop: 10 });
    expect(savedPlace("map", "a")).toEqual({ zoom: 12 });
    expect(savedPlace("map", "b")).toBeNull();
  });

  it("forgets one screen, or all of a trip's", () => {
    rememberPlace("timeline", "a", { view: "plan", scrollTop: 1 });
    rememberPlace("map", "a", { zoom: 3 });
    rememberPlace("timeline", "b", { view: "plan", scrollTop: 2 });
    forgetPlaces("a", "timeline");
    expect(savedPlace("timeline", "a")).toBeNull();
    expect(savedPlace("map", "a")).toEqual({ zoom: 3 });
    forgetPlaces("a");
    expect(savedPlace("map", "a")).toBeNull();
    expect(savedPlace("timeline", "b")).toEqual({ view: "plan", scrollTop: 2 });
  });
});

import { describe, it, expect } from "vitest";
import { userIdFromToken } from "@/shared/utils/authToken";
import { fakeToken } from "@/test/fakeToken";

describe("userIdFromToken", () => {
  it("reads the sub claim", () => {
    expect(userIdFromToken(fakeToken("8c1e-uuid"))).toBe("8c1e-uuid");
  });

  it("is null for anything that isn't a JWT with a sub", () => {
    expect(userIdFromToken(null)).toBeNull();
    expect(userIdFromToken("t")).toBeNull();
    expect(userIdFromToken("a.!!!.c")).toBeNull();
    expect(userIdFromToken(`x.${btoa(JSON.stringify({ aud: "x" }))}.y`)).toBeNull();
  });
});

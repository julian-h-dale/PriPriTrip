import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineBar } from "@/shared/components/OfflineBar";
import { formatSavedAt } from "@/shared/utils/time";

describe("OfflineBar", () => {
  it("shows nothing when live", () => {
    const { container } = render(<OfflineBar online stale={false} savedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says offline, and when the copy was saved", () => {
    render(<OfflineBar online={false} stale savedAt="2026-10-03T19:14:00Z" />);
    // The phone's own locale and zone format the instant.
    expect(screen.getByRole("status")).toHaveTextContent(
      `Offline · saved copy from ${formatSavedAt("2026-10-03T19:14:00Z")}`
    );
  });

  it("tells a down server apart from being offline", () => {
    render(<OfflineBar online stale savedAt={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Can’t reach the server");
  });
});

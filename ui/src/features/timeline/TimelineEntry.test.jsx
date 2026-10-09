import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimelineEntry } from "@/features/timeline/TimelineEntry";
import { setTextSize } from "@/shared/textSize";

const trip = { id: "trip-1", timezone: "Asia/Tokyo" };
const activity = (item) => ({
  kind: "activity",
  key: `activity-${item.id}`,
  item: { id: "a1", title: "Fushimi Inari shrine", ...item },
});
const TIMED = activity({
  id: "a1",
  start: "2026-05-11T09:00",
  end: "2026-05-11T11:30",
  location: { name: "Inari station" },
});
const UNTIMED = activity({ id: "a2", title: "Pick up rail passes" });

function renderEntry(entry, { menu = null } = {}) {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ul>
        <TimelineEntry entry={entry} trip={trip} menu={menu} />
      </ul>
    </MemoryRouter>
  );
  return screen.getByRole("link");
}

afterEach(() => act(() => setTextSize("normal")));

describe("TimelineEntry at Normal text", () => {
  it("keeps one line: time column, icon, text", () => {
    const link = renderEntry(TIMED);
    expect(screen.queryByTestId("entry-top-line")).not.toBeInTheDocument();
    expect(link.firstElementChild).toHaveTextContent(/^9:00\s?AM/);
    expect(link).toHaveTextContent("Fushimi Inari shrine");
  });

  it("shows a dash for an untimed entry", () => {
    expect(renderEntry(UNTIMED).firstElementChild).toHaveTextContent("—");
  });
});

describe.each(["large", "larger"])("TimelineEntry at %s text", (size) => {
  it("puts the time on a top line, with the title and place below it", () => {
    setTextSize(size);
    const link = renderEntry(TIMED);
    const top = screen.getByTestId("entry-top-line");
    expect(top.parentElement).toBe(link);
    expect(top).toHaveTextContent(/^9:00\s?AM\s*–\s*11:30\s?AM$/);
    expect(top).not.toHaveTextContent("Fushimi");
    const below = top.nextElementSibling;
    expect(below).toHaveTextContent("Fushimi Inari shrine");
    expect(below).toHaveTextContent("Inari station");
  });

  it("keeps an untimed entry's title beside its icon, with no dash", () => {
    setTextSize(size);
    const link = renderEntry(UNTIMED);
    expect(screen.queryByTestId("entry-top-line")).not.toBeInTheDocument();
    expect(link).not.toHaveTextContent("—");
    expect(link).toHaveTextContent("Pick up rail passes");
  });

  it("keeps the editor's menu outside the link", () => {
    setTextSize(size);
    const link = renderEntry(TIMED, { menu: <button type="button">Move</button> });
    expect(within(link).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(link).toHaveAttribute("href", expect.stringContaining("/trips/trip-1/"));
  });
});

it("re-lays out open rows when the text size changes", () => {
  renderEntry(TIMED);
  expect(screen.queryByTestId("entry-top-line")).not.toBeInTheDocument();
  act(() => setTextSize("larger"));
  expect(screen.getByTestId("entry-top-line")).toBeInTheDocument();
  act(() => setTextSize("normal"));
  expect(screen.queryByTestId("entry-top-line")).not.toBeInTheDocument();
});

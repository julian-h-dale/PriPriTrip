import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowMenu } from "@/shared/components/RowMenu";

const rect = (top, bottom, right) => ({ top, bottom, right, left: right - 40, width: 40, height: bottom - top, x: 0, y: top, toJSON() {} });

function renderMenu(onSelect = vi.fn()) {
  const { container } = render(
    <div style={{ overflow: "hidden" }} data-testid="row">
      <RowMenu label="More for Dinner" items={[{ label: "Move up", onSelect }, { label: "Move down", onSelect }]} />
    </div>
  );
  return container;
}

afterEach(() => vi.restoreAllMocks());

describe("RowMenu", () => {
  it("opens outside the row, so a row that clips can't cut it off", async () => {
    const onSelect = vi.fn();
    renderMenu(onSelect);
    await userEvent.click(screen.getByRole("button", { name: "More for Dinner" }));
    const menu = screen.getByRole("menu", { name: "More for Dinner" });
    expect(screen.getByTestId("row")).not.toContainElement(menu);
    expect(menu.parentElement).toBe(document.body);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens below the button, or above it near the bottom of the screen", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(90);
    const button = () => screen.getByRole("button", { name: "More for Dinner" });
    renderMenu();

    vi.spyOn(button(), "getBoundingClientRect").mockReturnValue(rect(100, 140, 360));
    await userEvent.click(button());
    expect(screen.getByRole("menu").style.top).toBe("144px");
    expect(screen.getByRole("menu").style.right).toBe(`${window.innerWidth - 360}px`);
    await userEvent.click(button());

    vi.spyOn(button(), "getBoundingClientRect").mockReturnValue(rect(window.innerHeight - 50, window.innerHeight - 10, 360));
    await userEvent.click(button());
    expect(screen.getByRole("menu").style.top).toBe(`${window.innerHeight - 50 - 4 - 90}px`);
  });

  it("closes on Escape, a click elsewhere, or a scroll", async () => {
    renderMenu();
    const button = screen.getByRole("button", { name: "More for Dinner" });
    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(button);
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(button);
    window.dispatchEvent(new Event("scroll"));
    expect(await screen.findByRole("button", { name: "More for Dinner" })).toHaveAttribute("aria-expanded", "false");
  });
});

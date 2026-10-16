import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DailyChart } from "./DailyChart";

const day = (date: string, newAppeared: number, returningAppeared: number, cohort: number, returned: number) => ({
  date,
  newAppeared,
  newPlayed: Math.floor(newAppeared / 2),
  returningAppeared,
  returningPlayed: returningAppeared - 1,
  newBack: { cohort, returned },
});

const DAILY = [
  day("2026-09-26", 10, 40, 10, 4),
  day("2026-09-27", 8, 30, 8, 2),
  day("2026-09-28", 6, 35, 0, 0),
];

describe("DailyChart", () => {
  it("reads the latest day until the pointer or the keys move it", () => {
    render(<DailyChart daily={DAILY} />);
    const plot = screen.getByRole("slider", { name: "Players per puzzle" });

    expect(plot).toHaveAttribute(
      "aria-valuetext",
      "Sep 28: New, turned up 6, New, played 3, Returning, turned up 35, Returning, played 34, new back within a week not known yet",
    );

    fireEvent.keyDown(plot, { key: "Home" });
    expect(plot).toHaveAttribute("aria-valuetext", expect.stringContaining("Sep 26: New, turned up 10"));
    expect(plot).toHaveAttribute("aria-valuetext", expect.stringContaining("new back within a week 40%"));
    expect(screen.getByText("40% (4 of 10)")).toBeInTheDocument();
  });

  it("breaks the return line where the week is not over", () => {
    render(<DailyChart daily={DAILY} />);
    const share = document.querySelector(".daily__panel--share path")!;

    expect(share.getAttribute("d")).toBe(" M 0 60 L 0 60 L 50 75");
  });

  it("says so when the window has no puzzles", () => {
    render(<DailyChart daily={[]} />);

    expect(screen.getByText("No puzzles in this window.")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DropDisplay } from "./DropDisplay";

describe("DropDisplay", () => {
  it("labels archived puzzles with their calendar date", () => {
    const { rerender } = render(<DropDisplay drop="str" />);
    expect(screen.getByText("Today's drop")).toBeInTheDocument();

    rerender(<DropDisplay drop="str" date="2026-08-11" isToday={false} />);
    expect(screen.getByText("Aug 11's drop")).toBeInTheDocument();
  });

  it("shows the drop's letters", () => {
    render(<DropDisplay drop="str" />);
    const letters = document.querySelectorAll(".drop-display__letter");
    expect([...letters].map((l) => l.textContent)).toEqual(["s", "t", "r"]);
  });

  it("shows no word of the day under the letters", () => {
    render(<DropDisplay drop="str" date="2026-09-12" />);
    expect(screen.queryByRole("button", { name: "Word of the day" })).not.toBeInTheDocument();
    expect(document.querySelector(".drop-display__ceiling-word")).not.toBeInTheDocument();
  });
});

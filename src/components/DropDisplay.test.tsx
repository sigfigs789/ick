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

  it("shows only the drop's letters", () => {
    render(<DropDisplay drop="str" />);
    expect(document.querySelectorAll(".drop-display__letter")).toHaveLength(3);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

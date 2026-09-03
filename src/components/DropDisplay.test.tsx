import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DropDisplay } from "./DropDisplay";
import { hintForDrop } from "../game/hints";

describe("DropDisplay", () => {
  it("labels archived puzzles with their calendar date", () => {
    const { rerender } = render(<DropDisplay drop="str" />);
    expect(screen.getByText("Today's drop")).toBeInTheDocument();

    rerender(<DropDisplay drop="str" date="2026-08-11" isToday={false} />);
    expect(screen.getByText("Aug 11's drop")).toBeInTheDocument();
  });

  it("shows the best-possible score but not the rarity while playing", () => {
    render(<DropDisplay drop="str" />);
    expect(screen.getByText("Best possible score: 10.0")).toBeInTheDocument();
    expect(screen.queryByText(/mythic/i)).not.toBeInTheDocument();
  });

  it("offers a hint while playing, and reveals it on demand", async () => {
    render(<DropDisplay drop="str" />);
    const button = screen.getByRole("button", { name: "See hint" });

    // The hint itself stays hidden until asked for -- offering one is not the
    // same as giving it away.
    expect(screen.queryByText(hintForDrop("str")!)).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.getByText(hintForDrop("str")!)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See hint" })).not.toBeInTheDocument();
  });

  it("offers no hint once the puzzle is done", () => {
    render(<DropDisplay drop="str" completed />);
    expect(screen.queryByRole("button", { name: "See hint" })).not.toBeInTheDocument();
  });

  it("offers no hint for a drop that has none", () => {
    render(<DropDisplay drop="zzzz" />);
    expect(screen.queryByRole("button", { name: "See hint" })).not.toBeInTheDocument();
  });
});

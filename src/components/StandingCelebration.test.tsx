import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StandingCelebration } from "./StandingCelebration";

describe("StandingCelebration", () => {
  it("names the band, the place and the share of the field behind it", async () => {
    const onDone = vi.fn();
    render(
      <StandingCelebration
        notice={{ kind: "entered", band: 5, rank: 4, size: 100, month: "2026-10-01", mode: "standard" }}
        onDone={onDone}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Top 5% this month!");
    expect(status).toHaveTextContent("You're 4th of 100 players so far, ahead of 96% of them.");
    await userEvent.click(screen.getByRole("button"));
    expect(onDone).toHaveBeenCalled();
  });
});

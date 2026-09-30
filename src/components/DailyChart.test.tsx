import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyChart } from "./DailyChart";

const day = (date: string, players: number, newPlayers: number, lookers = 0) => ({
  date,
  players,
  newPlayers,
  standard: players,
  freeform: 0,
  lookers,
});

const DAILY = [
  day("2026-09-26", 40, 4, 1),
  day("2026-09-27", 50, 5, 2),
  day("2026-09-28", 45, 9, 0),
  day("2026-09-29", 30, 3, 3),
];

function tab(name: string) {
  return screen.getByRole("tab", { name: new RegExp(`^${name}`) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function caption() {
  return document.querySelector(".daily__caption")!;
}

describe("DailyChart", () => {
  it("starts on the viewer's today, with the change against the day before", () => {
    render(<DailyChart daily={DAILY} today="2026-09-28" />);

    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-28");
    expect(within(tab("Players")).getByText("45")).toBeInTheDocument();
    expect(within(tab("Players")).getByText("−10%")).toBeInTheDocument();
    expect(within(tab("New players")).getByText("+80%")).toBeInTheDocument();
    expect(within(tab("Only looked")).getByText("−100%")).toBeInTheDocument();
    expect(caption()).toHaveTextContent("Mon Sep 28 · Today, change vs Sep 27");
  });

  it("falls back to the latest puzzle when today is not in the window", () => {
    render(<DailyChart daily={DAILY} today="2026-10-05" />);
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-29");
    expect(caption()).toHaveTextContent("6 days ago");
    // Nothing the day before to take a share of: the change is a count.
    expect(within(tab("Only looked")).getByText("+3")).toBeInTheDocument();
  });

  it("hops a day at a time with the buttons and the arrow keys, and back to today", async () => {
    render(<DailyChart daily={DAILY} today="2026-09-28" />);

    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-27");
    expect(within(tab("Players")).getByText("50")).toBeInTheDocument();

    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuetext", "Players 40 on Sat Sep 26");
    expect(screen.getByRole("button", { name: "Previous day" })).toBeDisabled();
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Players 30 on Tue Sep 29");
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-28");
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });

  it("jumps to a date picked in the box", () => {
    render(<DailyChart daily={DAILY} today="2026-09-28" />);
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-09-26" } });
    expect(within(tab("Players")).getByText("40")).toBeInTheDocument();
    expect(caption()).toHaveTextContent("2 days ago");
  });

  it("reads the day under the pointer without moving the pinned one", () => {
    // jsdom has no PointerEvent, and without one a pointer event drops clientX.
    vi.stubGlobal("PointerEvent", class extends MouseEvent {});
    render(<DailyChart daily={DAILY} today="2026-09-28" />);
    const slider = screen.getByRole("slider");
    slider.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 100 }) as DOMRect;

    fireEvent.pointerMove(slider, { clientX: 0 });
    expect(within(tab("Players")).getByText("40")).toBeInTheDocument();
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-28");

    fireEvent.pointerLeave(slider);
    expect(within(tab("Players")).getByText("45")).toBeInTheDocument();

    fireEvent.click(slider, { clientX: 100 });
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-27");
  });

  it("plots the tab that is picked", async () => {
    render(<DailyChart daily={DAILY} today="2026-09-28" />);
    await userEvent.click(tab("New players"));
    expect(tab("New players")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "New players 9 on Mon Sep 28");
  });
});

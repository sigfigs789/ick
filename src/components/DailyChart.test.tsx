import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyChart } from "./DailyChart";

const metrics = (players: number, acted: number, guessed: number, returned: number) => ({
  players,
  acted,
  guessed,
  // Half the guessers, so the Shared tab has a number of its own to read.
  shared: guessed / 2,
  returned,
});

/** Everyone's numbers, and the new players' a tenth of them. */
const day = (date: string, players: number, acted: number, guessed: number, returned: number, closed = false) => ({
  date,
  closed,
  groups: {
    all: metrics(players, acted, guessed, returned),
    new: metrics(players / 10, acted / 10, guessed / 10, returned / 10),
    returning: metrics(0, 0, 0, 0),
  },
});

const DAILY = [
  day("2026-09-26", 40, 30, 20, 10, true),
  day("2026-09-27", 50, 40, 30, 0),
  day("2026-09-28", 45, 30, 90, 0),
  day("2026-09-29", 30, 20, 10, 3),
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
  it("starts on the viewer's today, each number with its share of the day's players", () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-09-28" />);

    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-28");
    expect(within(tab("Players")).getByText("45")).toBeInTheDocument();
    expect(within(tab("Players")).getByText("10% new")).toBeInTheDocument();
    expect(within(tab("Guessed")).getByText("200%")).toBeInTheDocument();
    expect(within(tab("Did something")).getByText("67%")).toBeInTheDocument();
    expect(within(tab("Back within 7 days")).getByText("0%")).toBeInTheDocument();
    expect(caption()).toHaveTextContent("Mon Sep 28 · Today");
  });

  it("falls back to the latest puzzle when today is not in the window", () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-10-05" />);
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-29");
    expect(caption()).toHaveTextContent("6 days ago");
    expect(within(tab("Back within 7 days")).getByText("10%")).toBeInTheDocument();
  });

  it("hops a day at a time with the buttons and the arrow keys, and back to today", async () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-09-28" />);

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
    render(<DailyChart daily={DAILY} group="all" today="2026-09-28" />);
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-09-26" } });
    expect(within(tab("Players")).getByText("40")).toBeInTheDocument();
    expect(caption()).toHaveTextContent("2 days ago");
  });

  it("reads the day under the pointer without moving the pinned one", () => {
    // jsdom has no PointerEvent, and without one a pointer event drops clientX.
    vi.stubGlobal("PointerEvent", class extends MouseEvent {});
    render(<DailyChart daily={DAILY} group="all" today="2026-09-28" />);
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

  it("shows a lone day's numbers without a line to hop along", () => {
    render(<DailyChart daily={[DAILY[2]]} group="all" today="2026-09-28" />);
    expect(within(tab("Players")).getByText("45")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByText(/Mon Sep 28 · Today\. Pick a longer window/)).toBeInTheDocument();
  });

  it("plots the tab that is picked, as a share of the day's players in the tip", async () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-09-28" />);
    await userEvent.click(tab("Did something"));
    expect(tab("Did something")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Did something 30 on Mon Sep 28");
    expect(document.querySelector(".daily__tip")).toHaveTextContent("67% of 45 players");
  });

  it("reads the grouping it is given, with no share of new beside its players", () => {
    render(<DailyChart daily={DAILY} group="new" today="2026-09-28" />);
    expect(within(tab("Players")).getByText("4.5")).toBeInTheDocument();
    expect(within(tab("Players")).queryByText(/new/)).not.toBeInTheDocument();
  });

  it("marks the Freeform trial week's first and last day", () => {
    const trial = ["2026-09-13", "2026-09-14", "2026-09-20", "2026-09-26", "2026-09-27"].map((d) => day(d, 10, 5, 5, 1));
    render(<DailyChart daily={trial} group="all" today="2026-09-27" />);
    const labels = [...document.querySelectorAll(".daily__marker-label")].map((m) => m.textContent);
    expect(labels).toEqual(["Freeform week", "end"]);
  });

  it("marks only the end for a window that starts on the trial's last day", () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-09-28" />);
    const labels = [...document.querySelectorAll(".daily__marker-label")].map((m) => m.textContent);
    expect(labels).toEqual(["end"]);
  });

  it("marks the day chat's auto messages began", () => {
    const days = ["2026-10-12", "2026-10-13", "2026-10-14"].map((d) => day(d, 10, 5, 5, 1));
    render(<DailyChart daily={days} group="all" today="2026-10-14" />);
    const labels = [...document.querySelectorAll(".daily__marker-label")].map((m) => m.textContent);
    expect(labels).toEqual(["Chat auto messages"]);
  });

  it("draws no trial marks for a window after it", () => {
    render(<DailyChart daily={DAILY.slice(1)} group="all" today="2026-09-28" />);
    expect(document.querySelector(".daily__marker")).not.toBeInTheDocument();
  });

  it("starts on the day it is asked to focus", () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-09-29" focus="2026-09-27" />);
    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-27");
  });

  it("marks a day whose seven days are not over in the returns tab", async () => {
    render(<DailyChart daily={DAILY} group="all" today="2026-09-29" focus="2026-09-27" />);
    await userEvent.click(tab("Back within 7 days"));
    expect(document.querySelector(".daily__tip")).toHaveTextContent("too soon to tell");
    // Dashed from the last closed day on.
    expect(document.querySelector(".daily__line--live")).toBeInTheDocument();
  });
});

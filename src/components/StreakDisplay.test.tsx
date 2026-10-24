import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreakDisplay } from "./StreakDisplay";
import type { StreakState } from "../game/types";

const streak: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  totalCompleted: 0,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

// jsdom has no PointerEvent, so a pointer event's `pointerType` would be lost.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

/** The icon beside the count -- the badge carries its own 🧊, so not by text. */
function flame(): string | undefined {
  return document.querySelector(".streak-display__flame")?.textContent ?? undefined;
}

describe("StreakDisplay", () => {
  it("leaves out the zeros on the new play screen", () => {
    const { container, rerender } = render(
      <StreakDisplay streak={streak} hideEmpty hasWords={false} />
    );
    // A new player with nothing yet: no strip at all.
    expect(container).toBeEmptyDOMElement();

    // A streak too short to hold a freeze and no word today: the streak alone.
    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 2 }} hideEmpty hasWords={false} />);
    expect(screen.getByText("day streak")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Streak freezes/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();

    // Long enough to hold a freeze, with none held: the badge shows 0 of the cap.
    rerender(
      <StreakDisplay streak={{ ...streak, currentStreak: 15, longestStreak: 15 }} hideEmpty hasWords={false} />
    );
    expect(screen.getByRole("button", { name: /Streak freezes/ }).textContent).toBe("🧊0/2");

    // A streak that has ended keeps the cap its longest streak set: 0 of 2.
    rerender(<StreakDisplay streak={{ ...streak, longestStreak: 28 }} hideEmpty hasWords={false} />);
    expect(screen.getByText("day streak")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Streak freezes/ }).textContent).toBe("🧊0/2");

    // A freeze held and a word banked: both come back.
    rerender(
      <StreakDisplay
        streak={{ ...streak, currentStreak: 9, bankedFreezes: 1 }}
        totalRarity={7.5}
        hideEmpty
        hasWords
      />
    );
    expect(screen.getByRole("button", { name: /Streak freezes/ })).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("shows 😴 on an earned Saturday not played yet, and says it can't break the streak", () => {
    // 2026-10-31 is the first Saturday that can be earned; three days that week were played.
    const friday: StreakState = {
      ...streak,
      currentStreak: 5,
      lastCompletedDate: "2026-10-30",
      playedDates: ["2026-10-28", "2026-10-29", "2026-10-30"],
    };
    const { rerender } = render(<StreakDisplay streak={friday} date="2026-10-31" isToday />);
    const dancer = screen.getByRole("button", { name: /Lazy Saturday/ });
    expect(dancer.textContent).toBe("😴");
    // Hovering with a mouse opens the popup, and leaving closes it.
    const badge = dancer.parentElement as HTMLElement;
    fireEvent.pointerEnter(badge, { pointerType: "mouse" });
    expect(screen.getByRole("dialog", { name: "Lazy Saturday" })).toHaveTextContent(
      "can't break the streak"
    );
    fireEvent.pointerLeave(badge, { pointerType: "mouse" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Tapping opens it too.
    fireEvent.click(dancer);
    expect(screen.getByRole("dialog", { name: "Lazy Saturday" })).toHaveTextContent(
      "can't break the streak"
    );

    // Played: fire again.
    rerender(
      <StreakDisplay streak={{ ...friday, lastCompletedDate: "2026-10-31" }} date="2026-10-31" isToday />
    );
    expect(screen.queryByRole("button", { name: /Lazy Saturday/ })).not.toBeInTheDocument();
    expect(flame()).toBe("🔥");

    // Sunday after a skipped Saturday: fire, no freeze covering anything.
    rerender(<StreakDisplay streak={friday} date="2026-11-01" isToday />);
    expect(flame()).toBe("🔥");

    // Not earned: an ordinary day, where the streak has missed nothing yet.
    rerender(
      <StreakDisplay streak={{ ...friday, playedDates: ["2026-10-30"] }} date="2026-10-31" isToday />
    );
    expect(screen.queryByRole("button", { name: /Lazy Saturday/ })).not.toBeInTheDocument();
    expect(flame()).toBe("🔥");
  });

  it("shows the week's progress to a lazy Saturday on a weekday, then 😴", () => {
    const wednesday: StreakState = {
      ...streak,
      currentStreak: 5,
      lastCompletedDate: "2026-10-27",
      playedDates: ["2026-10-26", "2026-10-27"],
    };
    const { rerender } = render(<StreakDisplay streak={wednesday} date="2026-10-28" isToday />);
    const pie = screen.getByRole("button", { name: /Lazy Saturday/ });
    expect(pie.querySelector("svg")).not.toBeNull();
    fireEvent.click(pie);
    expect(screen.getByRole("dialog", { name: "Lazy Saturday" })).toHaveTextContent("2 of 3 so far");
    // The streak icon is untouched on a weekday.
    expect(flame()).toBe("🔥");

    rerender(
      <StreakDisplay
        streak={{ ...wednesday, lastCompletedDate: "2026-10-28", playedDates: [...wednesday.playedDates!, "2026-10-28"] }}
        date="2026-10-28"
        isToday
      />
    );
    expect(screen.getByRole("button", { name: /Lazy Saturday: Unlocked/ }).textContent).toBe("😴");
  });

  it("hides the flame until a streak reaches two days", () => {
    const { rerender } = render(<StreakDisplay streak={streak} />);
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 1 }} />);
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 2 }} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("tells the player to play today when missing today ends the streak", () => {
    const missed: StreakState = {
      ...streak,
      currentStreak: 5,
      lastCompletedDate: "2026-10-01",
      frozenDates: ["2026-10-02"],
    };
    const { rerender } = render(<StreakDisplay streak={missed} date="2026-10-03" isToday />);
    // The missed day spent the last saved freeze: the hourglass wins over the ice.
    expect(flame()).toBe("⏳");
    expect(screen.getByLabelText(/Play today to keep your streak/)).toBeInTheDocument();

    rerender(
      <StreakDisplay
        streak={{ ...missed, currentStreak: 6, lastCompletedDate: "2026-10-03" }}
        date="2026-10-03"
        isToday
      />
    );
    expect(flame()).toBe("🔥");
    expect(screen.queryByLabelText(/Play today/)).not.toBeInTheDocument();
  });

  it("shows ice from the first missed day once the player has a freeze cap", () => {
    // A 15-day run has no free day: the missed day spent a saved freeze.
    const missed: StreakState = {
      ...streak,
      currentStreak: 15,
      longestStreak: 15,
      lastCompletedDate: "2026-10-02",
      frozenDates: ["2026-10-03"],
      bankedFreezes: 1,
    };
    const { rerender } = render(<StreakDisplay streak={missed} date="2026-10-04" isToday />);
    expect(flame()).toBe("🧊");
    expect(document.querySelector(".streak-display__flame")).toHaveAttribute(
      "title",
      "A saved freeze is covering your streak"
    );
    expect(screen.queryByLabelText(/Play today/)).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...missed, bankedFreezes: 0 }} date="2026-10-04" isToday />);
    expect(flame()).toBe("⏳");
    expect(document.querySelector(".streak-display__flame")).toHaveAttribute(
      "title",
      expect.stringMatching(/none is left/)
    );

    rerender(
      <StreakDisplay
        streak={{ ...missed, currentStreak: 16, lastCompletedDate: "2026-10-04" }}
        date="2026-10-04"
        isToday
      />
    );
    expect(flame()).toBe("🔥");
  });

  it("turns the flame to ice while a saved freeze covers a missed day, until today is played", () => {
    const covered: StreakState = {
      ...streak,
      currentStreak: 20,
      lastCompletedDate: "2026-10-01",
      frozenDates: ["2026-10-02", "2026-10-03"],
      bankedFreezes: 0,
    };
    const { rerender } = render(<StreakDisplay streak={covered} date="2026-10-04" isToday />);
    // No freeze left for today: the hourglass wins over the ice.
    expect(flame()).toBe("⏳");
    expect(document.querySelector(".streak-display__flame")).toHaveAttribute(
      "title",
      expect.stringMatching(/none is left/)
    );
    expect(screen.getByLabelText(/Play today to keep your streak/)).toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...covered, bankedFreezes: 1 }} date="2026-10-04" isToday />);
    expect(flame()).toBe("🧊");
    expect(screen.queryByLabelText(/Play today/)).not.toBeInTheDocument();

    rerender(
      <StreakDisplay
        streak={{ ...covered, currentStreak: 21, lastCompletedDate: "2026-10-04" }}
        date="2026-10-04"
        isToday
      />
    );
    expect(flame()).toBe("🔥");
  });

  it("shows ice, not fire, on a past puzzle whose day a freeze covered", () => {
    const kept: StreakState = {
      ...streak,
      currentStreak: 12,
      longestStreak: 12,
      lastCompletedDate: "2026-10-05",
      frozenDates: ["2026-10-03"],
    };
    const { rerender } = render(<StreakDisplay streak={kept} date="2026-10-03" />);
    expect(flame()).toBe("🧊");
    expect(document.querySelector(".streak-display__flame")).toHaveAttribute(
      "title",
      expect.stringMatching(/freeze kept your streak alive on this day/)
    );

    // A played day keeps the fire.
    rerender(<StreakDisplay streak={kept} date="2026-10-04" />);
    expect(flame()).toBe("🔥");
  });

  it("shows saved freezes out of the most the streak can hold, with the rules in a popup", () => {
    render(<StreakDisplay streak={{ ...streak, currentStreak: 31, bankedFreezes: 1 }} />);
    const badge = screen.getByRole("button", { name: /streak freezes/i });
    expect(badge.textContent).toBe("🧊1/2");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(badge);
    const popup = screen.getByRole("dialog", { name: "Streak freezes" });
    expect(popup.querySelector("strong")?.textContent).toBe("1 of 2 🧊 acquired");
    expect(popup.textContent).toContain("Earn one on day 3, then every 7 days.");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(badge);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a past puzzle the freezes held on its day, and today the ones held now", () => {
    const later: StreakState = {
      ...streak,
      currentStreak: 20,
      longestStreak: 20,
      lastCompletedDate: "2026-10-10",
      bankedFreezes: 0,
      freezeHistory: { "2026-10-05": { banked: 1, cap: 2 } },
    };
    const badge = () => screen.getByRole("button", { name: /streak freezes/i }).textContent;
    const { rerender } = render(<StreakDisplay streak={later} date="2026-10-05" />);
    expect(badge()).toBe("🧊1/2");

    // A day with no record shows the ones held now.
    rerender(<StreakDisplay streak={later} date="2026-10-04" />);
    expect(badge()).toBe("🧊0/2");

    rerender(<StreakDisplay streak={later} date="2026-10-10" isToday />);
    expect(badge()).toBe("🧊0/2");
  });

  it("shows the cap the longest streak earned, even on a short current one", () => {
    render(<StreakDisplay streak={{ ...streak, currentStreak: 3, longestStreak: 45 }} />);
    expect(screen.getByRole("button", { name: /streak freezes/i }).textContent).toBe("🧊0/2");
  });

  it("shows three held from the old cap of three as over the cap of two", () => {
    render(<StreakDisplay streak={{ ...streak, currentStreak: 31, longestStreak: 40, bankedFreezes: 3 }} />);
    const badge = screen.getByRole("button", { name: /streak freezes/i });
    expect(badge.textContent).toBe("🧊3/2");
    fireEvent.click(badge);
    expect(screen.getByRole("dialog", { name: "Streak freezes" }).querySelector("strong")?.textContent).toBe(
      "3 🧊 acquired, over the limit of 2"
    );
  });

  it("shows the current puzzle's total only", () => {
    render(<StreakDisplay streak={{ ...streak, highScore: 9.3, crushedIt: 4, elite: 1 }} totalRarity={21.4} />);

    const scores = document.querySelector(".streak-display__rarity-scores");
    expect(scores?.textContent).toBe("Total21.4");
    // Only the total: no top score and no Crushed it / Elite counters.
    expect(screen.queryByText("Crushed it")).not.toBeInTheDocument();
    expect(screen.queryByText("Elite")).not.toBeInTheDocument();
    expect(screen.queryByText("High score")).not.toBeInTheDocument();
  });
});

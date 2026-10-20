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

    // A streak but no freeze held and no word today: the streak alone.
    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 3 }} hideEmpty hasWords={false} />);
    expect(screen.getByText("day streak")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Streak freezes/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();

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

  it("hides the flame until a streak reaches two days", () => {
    const { rerender } = render(<StreakDisplay streak={streak} />);
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 1 }} />);
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 2 }} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("keeps the flame on the free missed day, with a line saying to play today", () => {
    const missed: StreakState = {
      ...streak,
      currentStreak: 5,
      lastCompletedDate: "2026-10-01",
      frozenDates: ["2026-10-02"],
    };
    const { rerender } = render(<StreakDisplay streak={missed} date="2026-10-03" isToday />);
    expect(flame()).toBe("🔥");
    expect(screen.getByText("You missed yesterday. Play today to keep your streak.")).toBeInTheDocument();

    rerender(
      <StreakDisplay
        streak={{ ...missed, currentStreak: 6, lastCompletedDate: "2026-10-03" }}
        date="2026-10-03"
        isToday
      />
    );
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.queryByText(/Play today/)).not.toBeInTheDocument();
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
    expect(flame()).toBe("🧊");
    // No freeze left for today, so it says so.
    expect(screen.getByText(/Play today to keep your streak/)).toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...covered, bankedFreezes: 1 }} date="2026-10-04" isToday />);
    expect(screen.queryByText(/Play today to keep your streak/)).not.toBeInTheDocument();
    // A freeze left for today: not at risk, but the missed day is still news.
    expect(screen.getByText(/saved 🧊 will cover today/)).toBeInTheDocument();

    rerender(
      <StreakDisplay
        streak={{ ...covered, currentStreak: 21, lastCompletedDate: "2026-10-04" }}
        date="2026-10-04"
        isToday
      />
    );
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("says the free day covered yesterday when a saved freeze is left for today", () => {
    const missed: StreakState = {
      ...streak,
      currentStreak: 15,
      longestStreak: 15,
      lastCompletedDate: "2026-10-02",
      frozenDates: ["2026-10-03"],
      bankedFreezes: 1,
    };
    const { rerender } = render(<StreakDisplay streak={missed} date="2026-10-04" isToday />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText(/You missed yesterday\. Your saved 🧊 will cover today/)).toBeInTheDocument();
    expect(screen.queryByText(/Play today to keep your streak/)).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...missed, bankedFreezes: 0 }} date="2026-10-04" isToday />);
    expect(screen.getByText(/Play today to keep your streak/)).toBeInTheDocument();
    expect(screen.queryByText(/will cover today/)).not.toBeInTheDocument();

    rerender(
      <StreakDisplay
        streak={{ ...missed, currentStreak: 16, lastCompletedDate: "2026-10-04" }}
        date="2026-10-04"
        isToday
      />
    );
    expect(screen.queryByText(/You missed yesterday/)).not.toBeInTheDocument();
  });

  it("shows saved freezes out of the most the streak can hold, with the rules in a popup", () => {
    render(<StreakDisplay streak={{ ...streak, currentStreak: 31, bankedFreezes: 1 }} />);
    const badge = screen.getByRole("button", { name: /streak freezes/i });
    expect(badge.textContent).toBe("🧊1/2");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(badge);
    const popup = screen.getByRole("dialog", { name: "Streak freezes" });
    expect(popup.querySelector("strong")?.textContent).toBe("1 of 2 🧊 acquired");
    expect(popup.textContent).toContain("Earn an 🧊 every 7 days played.");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(badge);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the cap the longest streak earned, even on a short current one", () => {
    render(<StreakDisplay streak={{ ...streak, currentStreak: 3, longestStreak: 45 }} />);
    expect(screen.getByRole("button", { name: /streak freezes/i }).textContent).toBe("🧊0/2");
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

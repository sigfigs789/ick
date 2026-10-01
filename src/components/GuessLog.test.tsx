import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuessLog } from "./GuessLog";
import type { AcceptedWord, StreakState } from "../game/types";

const streak: StreakState = {
  currentStreak: 1,
  longestStreak: 1,
  totalCompleted: 1,
  crushedIt: 1,
  elite: 0,
  highScore: 6.8,
};

describe("GuessLog", () => {
  it("shows an empty state with no guesses", () => {
    render(<GuessLog acceptedWords={[]} />);
    expect(screen.getByText(/no words yet/i)).toBeInTheDocument();
  });

  it("lists each accepted word with its rarity", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
      { word: "stroll", rarity: "Common", zipf: 4.1 },
    ];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText("strange")).toBeInTheDocument();
    expect(screen.getByText("strut")).toBeInTheDocument();
    expect(screen.getByText("stroll")).toBeInTheDocument();
    // Guesses count up: three played, of four.
    expect(screen.getByText(/3 of 4 guesses/)).toBeInTheDocument();
  });

  it("counts against the six-guess limit an archive puzzle played with", () => {
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} date="2024-01-01" />);
    expect(screen.getByText(/1 of 6 guesses/)).toBeInTheDocument();
  });

  it("names the common form when scoring on it cost the guess real points", () => {
    // "materialnesses" is unmeasured, so its own score would be a flat 10;
    // it is scored as "material" instead, six points lower.
    const words: AcceptedWord[] = [
      { word: "materialnesses", rarity: "Common", zipf: 4.95 },
    ];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText(/scored as its common form, “material”/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /scored as its common form "material"/i })
    ).toBeInTheDocument();
  });

  it("explains the fold behind the note's More info", async () => {
    const words: AcceptedWord[] = [
      { word: "materialnesses", rarity: "Common", zipf: 4.95 },
    ];
    render(<GuessLog acceptedWords={words} />);

    await userEvent.click(
      screen.getByRole("button", {
        name: /why “materialnesses” was scored as its common form “material”/i,
      })
    );

    const panel = screen.getByRole("dialog", { name: /common forms/i });
    // The player's own pair first, then the rule it is an instance of.
    expect(panel).toHaveTextContent("materialnesses");
    expect(panel).toHaveTextContent("material");
    // One element per affix (they must not break across lines), so the row is
    // read off the heading's own list rather than matched as a sentence.
    const affixesUnder = (heading: RegExp) =>
      Array.from(
        screen
          .getByRole("heading", { name: heading })
          .parentElement!.querySelectorAll(".common-form__affix")
      ).map((node) => node.textContent);
    expect(affixesUnder(/adverbs and quality nouns/i)).toEqual(["-ly,", "-ness"]);
    expect(affixesUnder(/^prefixes$/i)).toEqual([
      "anti-,",
      "counter-,",
      "out-,",
      "over-,",
      "pre-,",
      "un-,",
      "under-",
    ]);

    await userEvent.click(screen.getByRole("button", { name: /close common forms/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers nothing to explain on a word scored on its own frequency", () => {
    const words: AcceptedWord[] = [{ word: "organization", rarity: "Common", zipf: 5.1 }];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.queryByText(/scored as its common form/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More info/i })).not.toBeInTheDocument();
  });

  it("names the common form even when the fold barely changed the score", () => {
    // "played" scores as "play" without leaving Common. With Freeform a switch
    // away, the two prices sit side by side, so every fold says so.
    const words: AcceptedWord[] = [{ word: "played", rarity: "Common", zipf: 4.79 }];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText(/scored as its common form, “play”/i)).toBeInTheDocument();
  });

  it("scores a word as itself in Standard rather than as a longer form", () => {
    // From SHORTER_FORMS_START "titty" is no longer capped at the commoner
    // "titties": it scores 7.19 in both modes, so there is nothing to explain.
    const words: AcceptedWord[] = [{ word: "titty", rarity: "Rare", zipf: 3.01 }];
    render(<GuessLog acceptedWords={words} date="2026-09-27" />);
    expect(screen.queryByText(/scored as its common form/i)).not.toBeInTheDocument();
  });

  it("names a common form longer than the word played", async () => {
    // "abaci" scores as "abacus" on the undated system, which still caps a word
    // at a longer form; so do the archived puzzles from 2026-08-24 to 09-26.
    const words: AcceptedWord[] = [{ word: "abaci", rarity: "Rare", zipf: 2.5 }];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText(/scored as its common form, “abacus”/i)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /why “abaci” was scored as its common form “abacus”/i })
    );
    const panel = screen.getByRole("dialog", { name: /common forms/i });
    expect(panel).toHaveTextContent(/“abaci” scores as “abacus”, its more common form/);
  });

  it("crowns the rarest word as the best one", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
    ];
    render(<GuessLog acceptedWords={words} />);
    const strutEntry = screen.getByText("strut").closest("li");
    expect(strutEntry).toHaveClass("guess-log__entry--best");
    const strangeEntry = screen.getByText("strange").closest("li");
    expect(strangeEntry).not.toHaveClass("guess-log__entry--best");
  });

  it("copies the tier square, word, and score when tapped and flashes a confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} />);

    await userEvent.click(screen.getByRole("button", { name: /copy "strange"/i }));

    // "🟫 strange (<score>)" — the brown square is the Common tier.
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^🟫 strange \(.+\)$/));
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("shows all trackers without a duplicate completion heading", () => {
    const words: AcceptedWord[] = [{ word: "strut", rarity: "Rare", zipf: 3.2 }];
    render(<GuessLog acceptedWords={words} completed streak={streak} />);
    expect(screen.queryByRole("heading", { name: /you won/i })).not.toBeInTheDocument();
    expect(screen.getByText("Crushed it")).toBeInTheDocument();
    expect(screen.getByText("Elite")).toBeInTheDocument();
    expect(screen.queryByText(/guess.*left/i)).not.toBeInTheDocument();
  });
});

describe("GuessLog retry", () => {
  const words: AcceptedWord[] = [
    { word: "strange", rarity: "Common", zipf: 4.6 },
    { word: "strut", rarity: "Rare", zipf: 3.2 },
  ];

  it("offers no retry when the puzzle isn't the one it belongs to", () => {
    render(<GuessLog acceptedWords={words} />);
    expect(screen.queryByRole("button", { name: /retry 1 word/i })).not.toBeInTheDocument();
  });

  it("arms, then swaps out the word the player picks", async () => {
    const onRetry = vi.fn();
    render(<GuessLog acceptedWords={words} canRetry retryOffered onRetry={onRetry} />);

    // Until it is armed, tapping a word still copies it.
    await userEvent.click(screen.getByRole("button", { name: /retry 1 word/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Retry "strange"/i }));

    expect(onRetry).toHaveBeenCalledWith("strange");
    // And it disarms itself, so the next tap copies again rather than dropping
    // a second word.
    expect(screen.getByRole("button", { name: /^Copy "strut"/i })).toBeInTheDocument();
  });

  it("says the limit in the button's own label, before it is ever pressed", () => {
    render(<GuessLog acceptedWords={words} canRetry retryOffered onRetry={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry 1 word/i })).toBeInTheDocument();
  });

  it("says what arming does without repeating the limit already stated above it", async () => {
    render(<GuessLog acceptedWords={words} canRetry retryOffered onRetry={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /retry 1 word/i }));

    expect(screen.getByText(/select a word to clear and try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/once per day/i)).not.toBeInTheDocument();
  });

  it("backs out without spending anything", async () => {
    const onRetry = vi.fn();
    render(<GuessLog acceptedWords={words} canRetry retryOffered onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: /retry 1 word/i }));
    await userEvent.click(screen.getByRole("button", { name: /never mind/i }));

    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Copy "strange"/i })).toBeInTheDocument();
  });

  it("replaces the control with a quiet, inert note once the retry is spent", () => {
    render(<GuessLog acceptedWords={words} retrySpent />);
    expect(screen.queryByRole("button", { name: /retry 1 word/i })).not.toBeInTheDocument();
    // The button's own spot now says what happened to it -- no separate
    // counter needed to learn the retry is gone.
    expect(screen.getByText(/retry used/i)).toBeInTheDocument();
    expect(screen.queryByText(/once per day/i)).not.toBeInTheDocument();
  });

  it("says nothing about retries at all on a puzzle that never offered one", () => {
    render(<GuessLog acceptedWords={words} />);
    expect(screen.queryByRole("button", { name: /retry 1 word/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/retry used/i)).not.toBeInTheDocument();
  });

  it("shows the button greyed out before there is anything to retry", () => {
    // retryOffered without canRetry: the puzzle carries a retry today, but
    // nothing has been banked yet to spend it on.
    render(<GuessLog acceptedWords={[]} retryOffered />);
    const button = screen.getByRole("button", { name: /retry 1 word/i });
    expect(button).toBeDisabled();
  });

  it("doesn't arm on a click while the button is disabled", async () => {
    const onRetry = vi.fn();
    render(<GuessLog acceptedWords={[]} retryOffered onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /retry 1 word/i }));
    expect(screen.queryByText(/select a word to clear/i)).not.toBeInTheDocument();
  });

  it("still offers the retry on a puzzle the last guess finished", () => {
    render(<GuessLog acceptedWords={words} completed streak={streak} canRetry retryOffered onRetry={vi.fn()} />);
    // The case the feature exists for: the slot is spent and the score is bad.
    expect(screen.getByRole("button", { name: /retry 1 word/i })).toBeInTheDocument();
  });
});

describe("GuessLog guess count", () => {
  it("shows only the guess count in the header -- no separate retry fraction", () => {
    // The retry used to sit here too, as a second "X of Y" beside the guess
    // count. It is a single yes/no reserve, not a running tally, so pairing
    // it with a real multi-step count read as the same kind of number when it
    // wasn't. That state now lives entirely on the retry control itself.
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} canRetry retryOffered />);
    expect(screen.getByText(/1 of 4 guesses/)).toBeInTheDocument();
    expect(screen.queryByText(/retr(y|ies)$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ retr/i)).not.toBeInTheDocument();
  });

  describe("the other mode", () => {
    const words: AcceptedWord[] = [
      { word: "kindless", rarity: "Common", zipf: 4.4 },
      { word: "kindly", rarity: "Common", zipf: 4.5 },
      { word: "kinder", rarity: "Common", zipf: 4.2 },
      { word: "kindest", rarity: "Common", zipf: 3.9 },
    ];

    it("offers to submit each word there, and shows the score only once it has been", async () => {
      const onCopy = vi.fn();
      render(
        <GuessLog
          acceptedWords={words}
          date="2026-10-01"
          otherMode="freeform"
          onCopyToOtherMode={onCopy}
          crossMode={{
            kindless: {
              state: "ready",
              word: { word: "kindless", rarity: "Legend", zipf: 0.4 },
              score: "9.91",
              needsLiveCheck: false,
            },
            kindly: {
              state: "copied",
              word: { word: "kindly", rarity: "Uncommon", zipf: 3.9 },
              score: "5.20",
            },
            kinder: { state: "refused", reason: "archaic" },
            kindest: { state: "full", word: { word: "kindest", rarity: "Rare", zipf: 3 }, score: "6.40" },
          }}
        />
      );

      // Not submitted yet: no price, from any state that has one.
      expect(screen.queryByText("9.91")).not.toBeInTheDocument();
      expect(screen.queryByText("6.40")).not.toBeInTheDocument();
      expect(screen.queryByText(/Legend/)).not.toBeInTheDocument();
      // Submitted: the score, with the tier's square beside its name.
      const submitted = screen.getByText("5.20").parentElement!;
      expect(submitted).toHaveTextContent("✓ Its score in Freeform: 5.20 🟩 Uncommon");
      expect(screen.getByText("Not playable in Freeform")).toBeInTheDocument();
      expect(screen.getByText("Freeform game finished")).toBeInTheDocument();
      // Only the one that can go has a control.
      const submit = screen.getAllByRole("button", { name: /^Submit “.*” to Freeform/ });
      expect(submit).toHaveLength(1);
      expect(submit[0]).toHaveTextContent("Submit to Freeform");
      await userEvent.click(submit[0]);
      expect(onCopy).toHaveBeenCalledWith("kindless");
    });

    it("disables every submit while one is running", () => {
      render(
        <GuessLog
          acceptedWords={[words[0]]}
          date="2026-10-01"
          otherMode="standard"
          copying="kindless"
          onCopyToOtherMode={vi.fn()}
          crossMode={{
            kindless: {
              state: "ready",
              word: { word: "kindless", rarity: "Mythic", zipf: 1.2 },
              score: "9.40",
              needsLiveCheck: true,
            },
          }}
        />
      );
      expect(screen.getByRole("button", { name: /to Standard/ })).toBeDisabled();
      expect(screen.getByText("Submitting…")).toBeInTheDocument();
    });
  });

  describe("the mode in the heading", () => {
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];

    it("names the game the log belongs to", () => {
      render(<GuessLog acceptedWords={words} date="2026-10-01" mode="freeform" />);
      expect(screen.getByRole("heading", { name: "Freeform guess log" })).toBeInTheDocument();
      const chip = document.querySelector(".guess-log__mode--freeform")!;
      // Rainbow letters on screen, and the word once for a screen reader.
      expect(chip.querySelectorAll(".rainbow-word__letter")).toHaveLength("Freeform".length);
      expect(chip.querySelector(".sr-only")).toHaveTextContent("Freeform");
    });

    it("keeps naming it once the puzzle is finished, without the count", () => {
      render(<GuessLog acceptedWords={words} date="2026-10-01" mode="standard" completed streak={streak} />);
      expect(screen.getByRole("heading", { name: "Standard guess log" })).toBeInTheDocument();
      expect(screen.queryByText(/of 4 guesses/)).not.toBeInTheDocument();
    });

    it("says only \"Guess log\" on a puzzle with one game", () => {
      render(<GuessLog acceptedWords={words} date="2026-09-20" />);
      expect(screen.getByRole("heading", { name: "Guess log" })).toBeInTheDocument();
    });
  });
});

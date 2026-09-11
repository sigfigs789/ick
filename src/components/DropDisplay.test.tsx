import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropDisplay } from "./DropDisplay";
import { definitionFor, formatRarityScore, learnableWordForDrop } from "../game/dictionary";

/**
 * A puzzle from before the reveal was gated, which prints its word the moment
 * the last guess lands -- the behaviour every day before REVEAL_GATE_START had
 * and keeps (see game/constants.revealGatedFor).
 */
const OPEN_DAY = "2026-09-01";
/** A puzzle from on or after the start, whose word waits to be asked for. */
const GATED_DAY = "2026-09-12";

describe("DropDisplay", () => {
  it("labels archived puzzles with their calendar date", () => {
    const { rerender } = render(<DropDisplay drop="str" />);
    expect(screen.getByText("Today's drop")).toBeInTheDocument();

    rerender(<DropDisplay drop="str" date="2026-08-11" isToday={false} />);
    expect(screen.getByText("Aug 11's drop")).toBeInTheDocument();
  });

  it("shows the best-possible score but not the rarity or word while playing", () => {
    render(<DropDisplay drop="str" />);
    expect(screen.getByText("Best possible score: 10.0")).toBeInTheDocument();
    expect(screen.queryByText(/mythic/i)).not.toBeInTheDocument();
    expect(document.querySelector(".drop-display__ceiling-word")).not.toBeInTheDocument();
  });

  it("reveals a learnable word, its score and its rarity once completed", () => {
    render(<DropDisplay drop="str" date={OPEN_DAY} isToday={false} completed />);
    const reveal = learnableWordForDrop("str", OPEN_DAY)!;
    expect(screen.getByText(reveal.word, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(formatRarityScore(reveal.zipf, OPEN_DAY))).toBeInTheDocument();
    // The score wears the tier's colours; the tier itself is named for a reader
    // who cannot see them.
    const score = screen.getByText(formatRarityScore(reveal.zipf, OPEN_DAY)).closest("span")!;
    expect(score.className).toContain("rarity--");
    expect(score).toHaveTextContent(reveal.rarity);
  });

  it("shows the definition with the reveal, and folds it away on request", async () => {
    render(<DropDisplay drop="str" date={OPEN_DAY} isToday={false} completed />);
    const reveal = learnableWordForDrop("str", OPEN_DAY)!;
    const definition = definitionFor(reveal.word)!;
    const toggle = screen.getByRole("button", { name: new RegExp(reveal.word) });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(definition)).not.toHaveClass("sr-only");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Still in the reading order once folded, just hidden from the eye.
    expect(screen.getByText(definition)).toHaveClass("sr-only");
  });

  it("holds the word behind a confirmation while the retry is unspent", async () => {
    const onReveal = vi.fn();
    render(<DropDisplay drop="str" date={GATED_DAY} completed retryOffered onReveal={onReveal} />);
    const reveal = learnableWordForDrop("str", GATED_DAY)!;
    expect(screen.queryByText(reveal.word, { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText(/uses your retry/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Word of the day" }));
    const dialog = screen.getByRole("dialog", { name: /reveal today's word/i });
    expect(dialog).toHaveTextContent(/uses up your retry/i);

    // Backing out costs nothing and leaves the word hidden.
    await userEvent.click(screen.getByRole("button", { name: /never mind/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.queryByText(reveal.word, { exact: false })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Word of the day" }));
    await userEvent.click(
      screen.getByRole("dialog").querySelector<HTMLButtonElement>(".reveal-modal__confirm")!,
    );
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByText(reveal.word, { exact: false })).toBeInTheDocument();
  });

  it("still asks on a puzzle with no retry left to charge, but charges nothing", async () => {
    render(
      <DropDisplay
        drop="str"
        date={GATED_DAY}
        isToday={false}
        completed
        retryOffered={false}
        onReveal={vi.fn()}
      />,
    );
    const reveal = learnableWordForDrop("str", GATED_DAY)!;
    expect(screen.queryByText(reveal.word, { exact: false })).not.toBeInTheDocument();
    // No price named, because there is none to pay.
    expect(screen.queryByText(/uses your retry/i)).not.toBeInTheDocument();

    // And no confirmation either: one press is the whole transaction.
    await userEvent.click(screen.getByRole("button", { name: "Word of the day" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(reveal.word, { exact: false })).toBeInTheDocument();
  });

  it("prints the word outright on a puzzle that dropped before the gate", () => {
    render(<DropDisplay drop="str" date={OPEN_DAY} isToday={false} completed retryOffered={false} />);
    expect(screen.queryByRole("button", { name: "Word of the day" })).not.toBeInTheDocument();
    expect(
      screen.getByText(learnableWordForDrop("str", OPEN_DAY)!.word, { exact: false }),
    ).toBeInTheDocument();
  });

  it("hides the word again when the puzzle changes underneath a reveal", async () => {
    const { rerender } = render(
      <DropDisplay drop="str" date={GATED_DAY} isToday={false} completed />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Word of the day" }));
    expect(
      screen.getByText(learnableWordForDrop("str", GATED_DAY)!.word, { exact: false }),
    ).toBeInTheDocument();

    rerender(<DropDisplay drop="ple" date="2026-09-13" isToday={false} completed />);
    expect(screen.getByRole("button", { name: "Word of the day" })).toBeInTheDocument();
  });

  it("opens the definition again when the puzzle changes underneath it", async () => {
    const { rerender } = render(
      <DropDisplay drop="str" date={OPEN_DAY} isToday={false} completed />,
    );
    const toggle = screen.getByRole("button", { name: /./ });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(<DropDisplay drop="ple" date="2026-08-11" isToday={false} completed />);
    expect(screen.getByRole("button", { name: /./ })).toHaveAttribute("aria-expanded", "true");
  });
});

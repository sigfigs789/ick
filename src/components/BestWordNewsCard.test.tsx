import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BestWordNewsCard } from "./BestWordNewsCard";
import { handleFor } from "../game/handle";
import type { ResolvedBest } from "../hooks/useYesterdaysBest";

const DAY = "2026-10-24";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";

function resolved(finderIds: string[], finders = finderIds.length): ResolvedBest {
  return {
    day: DAY,
    best: { word: "quixotic", zipf: 1.2, finders, rarity: "Mythic", foundOn: DAY, today: false },
    finderIds,
  };
}

describe("BestWordNewsCard", () => {
  it("congratulates the finder", () => {
    render(<BestWordNewsCard kind="self" resolved={resolved([A])} onDone={() => {}} />);
    expect(screen.getByText("You had yesterday's best word!")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("quixotic");
    expect(screen.getByRole("status").textContent).not.toContain("shared");
  });

  it("doesn't tell the finder who else found it", () => {
    render(<BestWordNewsCard kind="self" resolved={resolved([A, B], 4)} onDone={() => {}} />);
    expect(screen.getByText("You had yesterday's best word!")).toBeTruthy();
    expect(screen.getByRole("status").textContent).not.toContain("shared");
    expect(screen.getByRole("status").textContent).not.toContain("other player");
  });

  it("names who found it for everybody else", () => {
    const { unmount } = render(
      <BestWordNewsCard kind="other" resolved={resolved([A])} onDone={() => {}} />,
    );
    expect(screen.getByText("Yesterday's best word")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(`${handleFor(A)} found quixotic`);
    unmount();

    render(<BestWordNewsCard kind="other" resolved={resolved([A, B], 4)} onDone={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain(
      `${handleFor(A)} and 3 other players found quixotic`,
    );
  });

  it("goes on a tap", () => {
    const onDone = vi.fn();
    render(<BestWordNewsCard kind="other" resolved={resolved([A])} onDone={onDone} />);
    fireEvent.click(screen.getByTitle("Dismiss"));
    expect(onDone).toHaveBeenCalled();
  });
});

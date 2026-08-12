import { track } from "@vercel/analytics";
import { describe, expect, it, vi } from "vitest";
import { trackRejectedAnswer } from "./analytics";
import { puzzleNumber } from "./game/share";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

describe("trackRejectedAnswer", () => {
  it("records the normalized word and rejection reason", () => {
    trackRejectedAnswer("2026-08-12", "  BaNANA  ", "not-a-word");

    expect(track).toHaveBeenCalledWith("answer_rejected", {
      puzzle_date: "2026-08-12",
      puzzle_number: puzzleNumber("2026-08-12"),
      word: "banana",
      rejection_reason: "not-a-word",
    });
  });
});

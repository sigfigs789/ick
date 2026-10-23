import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseFormSubstitution, foldTrace, rarityFor } from "./dictionary";
import { foldedRows } from "./foldedRows";
import { clearLiveFoldRejections, setLiveFoldRejections } from "./liveFoldRejections";
import { liveFoldRescore, markNoticesSeen, unseenNotices } from "./liveFoldRescore";
import { loadProgress, newProgress, recordAcceptedWord, rescoreAcceptedWords } from "./storage";
import type { DailyProgress } from "./types";

const DATE = "2026-10-12";
const OTHER = "2026-10-11";

beforeEach(() => {
  localStorage.clear();
  clearLiveFoldRejections();
});
afterEach(() => clearLiveFoldRejections());

describe("live fold rejections in the scoring", () => {
  it("folds a word until its fold is rejected on that puzzle", () => {
    expect(rarityFor("timelessly", DATE, "standard")?.zipf).toBe(6.29);
    setLiveFoldRejections(DATE, [{ word: "timelessly", base: "time" }]);
    expect(rarityFor("timelessly", DATE, "standard")?.zipf).toBe(1.58);
    expect(baseFormSubstitution("timelessly", DATE)).toBeUndefined();
  });

  it("leaves every other puzzle alone", () => {
    setLiveFoldRejections(DATE, [{ word: "timelessly", base: "time" }]);
    expect(rarityFor("timelessly", OTHER, "standard")?.zipf).toBe(6.29);
  });

  it("still reports the rule's fold to the review page", () => {
    setLiveFoldRejections(DATE, [{ word: "timelessly", base: "time" }]);
    expect(foldTrace("timelessly", DATE, undefined, "standard")?.base).toBe("time");
  });
});

describe("the rows /folded-live shows", () => {
  it("lists the banked Standard words that folded, biggest drop first", () => {
    const find = (word: string, extra = {}) => ({
      word, rarity: "Common" as const, zipf: 5, finders: 2, foundOn: DATE, today: false, ...extra,
    });
    const rows = foldedRows(DATE, [
      find("playfulness"),
      find("quickly"),
      find("timelessly"),
      find("kindnesses", { standard: false as const }),
    ]);
    expect(rows.map((row) => [row.word, row.base])).toEqual([
      ["timelessly", "time"],
      ["playfulness", "playful"],
    ]);
  });
});

describe("rescoring a played game", () => {
  function played() {
    let progress: DailyProgress = { ...newProgress(DATE, "TIM"), mode: "standard" };
    progress = recordAcceptedWord(progress, { word: "timelessly", rarity: "Common", zipf: 6.29 });
    progress = recordAcceptedWord(progress, { word: "kindnesses", rarity: "Common", zipf: 5.45 });
    return progress;
  }

  it("reprices only the rejected word, saves it, and owes a notice", () => {
    const before = played();
    setLiveFoldRejections(DATE, [{ word: "timelessly", base: "time" }]);
    const { rescored, notices } = liveFoldRescore(before);
    expect(notices).toEqual([{ word: "timelessly", base: "time", zipf: 1.58 }]);
    const after = rescoreAcceptedWords(before, rescored);
    expect(after.acceptedWords.map((w) => w.zipf)).toEqual([1.58, 5.45]);
    expect(loadProgress(DATE, "standard")?.acceptedWords[0].zipf).toBe(1.58);
    // A second open finds nothing left to move, but still owes the notice.
    const again = liveFoldRescore(after);
    expect(rescoreAcceptedWords(after, again.rescored)).toBe(after);
    expect(again.notices).toHaveLength(1);
  });

  it("does nothing to a Freeform game", () => {
    const freeform = { ...played(), mode: "freeform" as const };
    setLiveFoldRejections(DATE, [{ word: "timelessly", base: "time" }]);
    expect(liveFoldRescore(freeform).notices).toEqual([]);
  });

  it("stops showing a notice once it is closed", () => {
    const notice = { word: "timelessly", base: "time", zipf: 1.58 };
    expect(unseenNotices(DATE, [notice])).toHaveLength(1);
    markNoticesSeen(DATE, [notice]);
    expect(unseenNotices(DATE, [notice])).toEqual([]);
    expect(unseenNotices(OTHER, [notice])).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_LENGTH,
  chatProblem,
  normaliseMessage,
  tierNoticeBody,
  topNoticeBody,
} from "./chat";

describe("chat rules", () => {
  it("collapses whitespace and line breaks", () => {
    expect(normaliseMessage("  hello \n\n  there\t ")).toBe("hello there");
  });

  it("passes ordinary messages, including words that merely contain a bad one", () => {
    expect(chatProblem("found quixotic today!")).toBeNull();
    expect(chatProblem("an assassin from Scunthorpe")).toBeNull();
  });

  it("refuses empty and over-long messages", () => {
    expect(chatProblem("")).toBe("empty");
    expect(chatProblem("a".repeat(CHAT_MAX_LENGTH + 1))).toBe("too-long");
    expect(chatProblem("a".repeat(CHAT_MAX_LENGTH))).toBeNull();
  });

  it("refuses profanity, including disguised spellings", () => {
    expect(chatProblem("what the fuck")).toBe("profane");
    expect(chatProblem("sh1t")).toBe("profane");
    expect(chatProblem("shiiiit")).toBe("profane");
  });

  it("refuses the blocklist's slurs that obscenity misses, as whole words only", () => {
    for (const word of ["coon", "gook", "jap", "squaw", "wetback", "wop"]) {
      expect(chatProblem(`hey ${word} there`), word).toBe("profane");
      expect(chatProblem(`hey ${word.toUpperCase()}!`), word).toBe("profane");
    }
    expect(chatProblem("a raccoon in japan")).toBeNull();
  });

  it("leaves the blocklist's ordinary words alone", () => {
    expect(chatProblem("aka the ave near corp hq")).toBeNull();
    expect(chatProblem("my cripple sheep")).toBeNull();
  });
});

describe("chat notices", () => {
  const word = { date: "2026-10-13", word: "abaci", tier: "Mythic", score: "9.62", mode: "standard" as const };

  it("names the player, the word, its tier and its score", () => {
    expect(topNoticeBody("StormyFox47", word)).toBe(
      "StormyFox47 banked top scoring word abaci (Mythic, 9.62)"
    );
    expect(tierNoticeBody("StormyFox47", word)).toBe("StormyFox47 banked Mythic word abaci (9.62)");
  });

  it("says when the word was banked in Freeform", () => {
    expect(topNoticeBody("StormyFox47", { ...word, mode: "freeform" })).toBe(
      "StormyFox47 banked top scoring word abaci (Mythic, 9.62) in Freeform"
    );
  });

  it("has no tier line for a word under 9.5", () => {
    expect(tierNoticeBody("StormyFox47", { ...word, tier: "Elusive", score: "9.4" })).toBeNull();
    expect(tierNoticeBody("StormyFox47", { ...word, score: "9.5" })).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_LENGTH,
  chatProblem,
  EARLIER_LINES,
  earlierNoticeBody,
  earnsNotice,
  FINDER_PLACEHOLDER,
  findNoticeBody,
  normaliseMessage,
  isReactionEmoji,
  noticeVerb,
  NOTICE_VERBS,
  reactorsLabel,
  toggled,
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

  const verb = noticeVerb("StormyFox47", "abaci");

  it("names the player, the word and its score, leaving tier and mode to the coloring", () => {
    expect(findNoticeBody("StormyFox47", word)).toBe(`StormyFox47 ${verb} abaci 9.62!`);
    expect(findNoticeBody("StormyFox47", { ...word, mode: "freeform", tier: "Legend", score: "9.94" })).toBe(
      `StormyFox47 ${verb} abaci 9.94!`
    );
  });

  it("rotates the verb across words, the same one every time for a given word", () => {
    expect(NOTICE_VERBS).toContain(verb);
    expect(noticeVerb("StormyFox47", "abaci")).toBe(verb);
    const verbs = new Set(["abaci", "quokka", "jonesing", "zephyr", "lacuna", "nimbus"].map(
      (w) => noticeVerb("StormyFox47", w),
    ));
    expect(verbs.size).toBeGreaterThan(1);
  });

  it("announces nothing under 9.5 or below Mythic", () => {
    expect(findNoticeBody("StormyFox47", { ...word, tier: "Elusive", score: "9.4" })).toBeNull();
    expect(findNoticeBody("StormyFox47", { ...word, tier: "Elusive", score: "9.5" })).toBeNull();
    expect(earlierNoticeBody("StormyFox47", { ...word, tier: "Elusive", score: "9.4" })).toBeNull();
    expect(findNoticeBody("StormyFox47", { ...word, score: "9.5" })).not.toBeNull();
    expect(earnsNotice({ tier: "Legend", score: "10.00" })).toBe(true);
  });

  it("tells a later finder who got there first, worded a few ways", () => {
    const line = earlierNoticeBody("CalmOtter3", word);
    expect(line).toContain(FINDER_PLACEHOLDER);
    expect(line).toContain("abaci");
    expect(line?.endsWith(" in standard mode")).toBe(true);
    expect(earlierNoticeBody("CalmOtter3", word)).toBe(line);
    const lines = new Set(["abaci", "quokka", "jonesing", "zephyr", "lacuna", "nimbus"].map(
      (w) => earlierNoticeBody("CalmOtter3", { ...word, word: w }),
    ));
    expect(lines.size).toBeGreaterThan(1);
    expect(EARLIER_LINES.length).toBeGreaterThan(1);
  });
});

describe("chat reactions", () => {
  it("takes one emoji of any shape", () => {
    for (const emoji of ["👍", "❤️", "👍🏽", "🇺🇸", "1️⃣", "👨‍👩‍👧‍👦", "🏳️‍🌈", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) {
      expect(isReactionEmoji(emoji)).toBe(true);
    }
  });

  it("refuses text, two emoji, and anything that is not a string", () => {
    for (const raw of ["", "a", "1", "lol", "👍👍", "hi👍", "👍 ", "\u200d", 5, null]) {
      expect(isReactionEmoji(raw)).toBe(false);
    }
  });

  it("adds and takes back the player's own reaction", () => {
    const start = [{ emoji: "🔥", handles: ["A1"] }];
    expect(toggled(start, "🔥", "Me", true)).toEqual([{ emoji: "🔥", handles: ["A1", "Me"] }]);
    expect(toggled(start, "👍", "Me", true)).toEqual([...start, { emoji: "👍", handles: ["Me"] }]);
    expect(toggled([{ emoji: "🔥", handles: ["Me"] }], "🔥", "Me", false)).toEqual([]);
    expect(toggled(start, "🔥", "Me", false)).toEqual(start);
  });

  it("names who reacted, the player as you", () => {
    expect(reactorsLabel(["A1"], "Me")).toBe("A1");
    expect(reactorsLabel(["A1", "Me"], "Me")).toBe("A1 and you");
    expect(reactorsLabel(["A1", "B2", "C3"], null)).toBe("A1, B2 and C3");
    expect(reactorsLabel(["A1", "B2", "C3", "D4"], null)).toBe("A1, B2 and 2 others");
  });
});

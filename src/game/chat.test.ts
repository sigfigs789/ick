import { describe, expect, it } from "vitest";
import { CHAT_MAX_LENGTH, chatProblem, normaliseMessage } from "./chat";

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

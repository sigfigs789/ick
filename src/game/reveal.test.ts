import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REVEAL, loadReveal, saveReveal } from "./reveal";

beforeEach(() => {
  localStorage.clear();
});

describe("the remembered Show answers choice", () => {
  it("is Top for a player who has never touched the toggle", () => {
    expect(DEFAULT_REVEAL).toBe("top");
    expect(loadReveal()).toBe("top");
  });

  it("is remembered once chosen", () => {
    for (const reveal of ["none", "all", "top"] as const) {
      saveReveal(reveal);
      expect(loadReveal()).toBe(reveal);
    }
  });

  it("falls back to Top for storage holding nonsense", () => {
    localStorage.setItem("ick:reveal", "some");
    expect(loadReveal()).toBe("top");
  });
});

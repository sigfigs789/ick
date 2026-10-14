import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SHOW_NAME, loadShowName, saveShowName } from "./shareName";

describe("the Show username choice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the name for a player who has never chosen", () => {
    expect(DEFAULT_SHOW_NAME).toBe(true);
    expect(loadShowName()).toBe(true);
  });

  it("remembers either choice", () => {
    saveShowName(false);
    expect(loadShowName()).toBe(false);
    saveShowName(true);
    expect(loadShowName()).toBe(true);
  });

  it("falls back to the default on a value it does not recognise", () => {
    localStorage.setItem("ick:share-name", "maybe");
    expect(loadShowName()).toBe(true);
  });
});

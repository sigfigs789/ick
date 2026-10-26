import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHOW_NAME,
  excludeShareNameIfChosen,
  hasChosenShowName,
  loadShowName,
  saveShowName,
} from "./shareName";
import { assignShareNameArm, isExcludedFromShareNameTest } from "./shareNameTest";

describe("the Show username choice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the name for a player who has never chosen and is not drawn", () => {
    expect(DEFAULT_SHOW_NAME).toBe(true);
    expect(loadShowName()).toBe(true);
    expect(hasChosenShowName()).toBe(false);
  });

  it("remembers either choice", () => {
    saveShowName(false);
    expect(loadShowName()).toBe(false);
    expect(hasChosenShowName()).toBe(true);
    saveShowName(true);
    expect(loadShowName()).toBe(true);
  });

  it("falls back to the default on a value it does not recognise", () => {
    localStorage.setItem("ick:share-name", "maybe");
    expect(loadShowName()).toBe(true);
    expect(hasChosenShowName()).toBe(false);
  });

  it("defaults to the player's arm of the share name test", () => {
    assignShareNameArm(() => 0.9);
    expect(loadShowName()).toBe(false);
    localStorage.clear();
    assignShareNameArm(() => 0);
    expect(loadShowName()).toBe(true);
  });

  it("lets a saved choice win over the arm", () => {
    assignShareNameArm(() => 0.9);
    saveShowName(true);
    expect(loadShowName()).toBe(true);
  });

  it("keeps a player who chose before the test out of it for good", () => {
    saveShowName(false);
    excludeShareNameIfChosen();
    expect(isExcludedFromShareNameTest()).toBe(true);
    localStorage.removeItem("ick:share-name");
    expect(assignShareNameArm(() => 0.9)).toBeNull();
    expect(loadShowName()).toBe(DEFAULT_SHOW_NAME);
  });

  it("leaves an unchosen player, or one already drawn, as they are at startup", () => {
    excludeShareNameIfChosen();
    expect(isExcludedFromShareNameTest()).toBe(false);
    assignShareNameArm(() => 0.9);
    saveShowName(true);
    excludeShareNameIfChosen();
    expect(isExcludedFromShareNameTest()).toBe(false);
    expect(assignShareNameArm()).toEqual({ variant: "hidden", fresh: false });
  });
});

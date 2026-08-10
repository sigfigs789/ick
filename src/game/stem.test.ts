import { describe, expect, it } from "vitest";
import { baseForm } from "./stem";

describe("baseForm", () => {
  it("strips a simple plural s", () => {
    expect(baseForm("cars")).toBe("car");
  });

  it("does not strip a word ending in double s", () => {
    expect(baseForm("class")).toBe("class");
  });

  it("strips -es", () => {
    expect(baseForm("glasses")).toBe("glass");
  });

  it("strips -ies to y", () => {
    expect(baseForm("puppies")).toBe("puppy");
  });

  it("strips -ing and undoes a doubled consonant", () => {
    expect(baseForm("running")).toBe("run");
  });

  it("strips -ing without a doubled consonant", () => {
    expect(baseForm("hoping")).toBe("hop");
  });

  it("strips -ed and undoes a doubled consonant", () => {
    expect(baseForm("stopped")).toBe("stop");
  });

  it("strips -ied to y", () => {
    expect(baseForm("carried")).toBe("carry");
  });

  it("strips a longer -ying to y", () => {
    expect(baseForm("studying")).toBe("study");
  });

  it("leaves short words alone", () => {
    expect(baseForm("cat")).toBe("cat");
  });

  it("is case-insensitive", () => {
    expect(baseForm("CARS")).toBe(baseForm("cars"));
  });

  it("collapses start and starting to the same root", () => {
    expect(baseForm("starting")).toBe(baseForm("start"));
  });
});

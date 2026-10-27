import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  HEADER_CLEARANCE_PROPERTY,
  headerClearance,
  useHeaderClearance,
} from "./useHeaderClearance";

function headerEndingAt(bottom: number) {
  const header = document.createElement("header");
  header.className = "app__header";
  header.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  document.body.append(header);
  return header;
}

const clearance = () =>
  document.documentElement.style.getPropertyValue(HEADER_CLEARANCE_PROPERTY);

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty(HEADER_CLEARANCE_PROPERTY);
});

describe("headerClearance", () => {
  it("is the header's bottom edge while it is on screen", () => {
    expect(headerClearance(headerEndingAt(72.4))).toBe(72);
  });

  it("is 0 once the header has scrolled away", () => {
    expect(headerClearance(headerEndingAt(-140))).toBe(0);
  });

  it("is 0 with no header at all", () => {
    expect(headerClearance(null)).toBe(0);
  });
});

describe("useHeaderClearance", () => {
  it("sets the clearance only while a card is up", () => {
    headerEndingAt(80);
    const { rerender, unmount } = renderHook(({ active }) => useHeaderClearance(active), {
      initialProps: { active: false },
    });
    expect(clearance()).toBe("");
    rerender({ active: true });
    expect(clearance()).toBe("80px");
    rerender({ active: false });
    expect(clearance()).toBe("");
    unmount();
  });
});

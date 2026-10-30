import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeepInViewport } from "./useKeepInViewport";

function Popup({ open }: { open: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useKeepInViewport(ref, open);
  return <span className="rest-day__popup" ref={ref} data-testid="popup" />;
}

/** Lays every popup out at `left`..`left + 200`, `top` from the top, on a 400px-wide screen. */
function layOut(left: number, top = 100) {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(left, top, 200, 80)
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useKeepInViewport", () => {
  it("leaves a popup that fits where it is", () => {
    layOut(100);
    const { getByTestId } = render(<Popup open />);
    expect(getByTestId("popup").style.translate).toBe("");
    expect(getByTestId("popup")).not.toHaveClass("rest-day__popup--below");
  });

  it("pulls a popup hanging off the right edge back on screen", () => {
    layOut(300);
    const { getByTestId } = render(<Popup open />);
    // 300 + 200 = 500 against 400 - 16: back 116px.
    expect(getByTestId("popup").style.translate).toBe("-116px 0");
  });

  it("pushes a popup hanging off the left edge back on screen", () => {
    layOut(-50);
    const { getByTestId } = render(<Popup open />);
    expect(getByTestId("popup").style.translate).toBe("66px 0");
  });

  it("opens below when there's no room above", () => {
    layOut(100, -20);
    const { getByTestId } = render(<Popup open />);
    expect(getByTestId("popup")).toHaveClass("rest-day__popup--below");
  });

  it("leaves a closed popup alone", () => {
    layOut(300);
    const { getByTestId } = render(<Popup open={false} />);
    expect(getByTestId("popup").style.translate).toBe("");
  });
});

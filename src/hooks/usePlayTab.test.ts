import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isReporting, trackPlayTabAssigned } from "../analytics";
import { usePlayTab } from "./usePlayTab";

vi.mock("../analytics", () => ({
  isReporting: vi.fn(() => true),
  trackPlayTabAssigned: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isReporting).mockReturnValue(true);
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("usePlayTab", () => {
  it("draws a player once, on the first load, and reports it", () => {
    const first = renderHook(() => usePlayTab());
    const arm = localStorage.getItem("ick:play-tab-test");
    expect(arm === "shown" || arm === "hidden").toBe(true);
    expect(first.result.current).toBe(arm === "shown");
    expect(trackPlayTabAssigned).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackPlayTabAssigned).mock.calls[0][0]).toBe(arm);
    expect(vi.mocked(trackPlayTabAssigned).mock.calls[0][2]).toBe(false);

    first.unmount();
    renderHook(() => usePlayTab());
    expect(trackPlayTabAssigned).toHaveBeenCalledTimes(1);
  });

  it("shows a forced arm without drawing it", () => {
    window.history.pushState(null, "", "/?play-tab=shown");
    const { result } = renderHook(() => usePlayTab());
    expect(result.current).toBe(true);
    expect(localStorage.getItem("ick:play-tab-test")).toBeNull();
    expect(trackPlayTabAssigned).not.toHaveBeenCalled();
  });

  it("keeps the icon off and draws nobody where nothing is reported", () => {
    vi.mocked(isReporting).mockReturnValue(false);
    const { result } = renderHook(() => usePlayTab());
    expect(result.current).toBe(false);
    expect(localStorage.getItem("ick:play-tab-test")).toBeNull();
  });
});

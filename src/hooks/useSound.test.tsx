import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { playAccept, playComplete, playReject } from "../audio/sound";
import { useSound } from "./useSound";

vi.mock("../audio/sound", () => ({
  playAccept: vi.fn(),
  playComplete: vi.fn(),
  playReject: vi.fn(),
}));

describe("useSound", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("plays feedback while enabled and persists a muted preference", () => {
    const { result } = renderHook(() => useSound());
    expect(result.current.enabled).toBe(true);

    act(() => {
      result.current.accept("Rare");
      result.current.reject();
      result.current.complete();
    });
    expect(playAccept).toHaveBeenCalledWith("Rare");
    expect(playReject).toHaveBeenCalledTimes(1);
    expect(playComplete).toHaveBeenCalledTimes(1);

    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem("ick:soundEnabled")).toBe("off");

    act(() => result.current.accept("Rare"));
    expect(playAccept).toHaveBeenCalledTimes(1);
  });

  it("restores a saved muted preference", () => {
    localStorage.setItem("ick:soundEnabled", "off");
    const { result } = renderHook(() => useSound());

    expect(result.current.enabled).toBe(false);
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { playAccept, playComplete, playJackpot, playReject, vibrate } from "../audio/sound";
import { useSound } from "./useSound";

vi.mock("../audio/sound", () => ({
  playAccept: vi.fn(),
  playComplete: vi.fn(),
  playReject: vi.fn(),
  playJackpot: vi.fn(),
  vibrate: vi.fn(),
}));

describe("useSound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plays the feedback for each kind of submission", () => {
    const { result } = renderHook(() => useSound());

    act(() => {
      result.current.accept("Rare");
      result.current.reject();
      result.current.complete();
    });
    expect(playAccept).toHaveBeenCalledWith("Rare");
    expect(playReject).toHaveBeenCalledTimes(1);
    expect(playComplete).toHaveBeenCalledTimes(1);
  });

  it("buzzes with every accepted word, and has a jackpot for the top tiers", () => {
    const { result } = renderHook(() => useSound());

    act(() => {
      result.current.accept("Legend");
      result.current.jackpot();
    });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(playJackpot).toHaveBeenCalledTimes(1);
  });
});

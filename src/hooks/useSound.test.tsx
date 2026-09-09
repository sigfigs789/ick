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
});

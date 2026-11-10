import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBlob } from "html-to-image";
import { TopRankCelebration } from "./TopRankCelebration";

vi.mock("html-to-image", () => ({ toBlob: vi.fn() }));

describe("CelebrationShareButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares a still of the card it sits in, without its controls, signed WordInk", async () => {
    vi.mocked(toBlob).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { canShare: () => true, share });
    const onDone = vi.fn();
    render(<TopRankCelebration rank={1} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Share this as an image" }));
    expect(await screen.findByText("Shared!")).toBeInTheDocument();

    const node = vi.mocked(toBlob).mock.calls[0][0] as HTMLElement;
    expect(node.textContent).toContain("#1 today!");
    expect(node.textContent).toContain("WordInk");
    expect(node.textContent).not.toContain("×");
    expect(node.textContent).not.toContain("Share");
    expect(node.textContent).not.toContain("See the leaderboard");
    // The still is gone once taken, and the card itself stays up.
    expect(node.isConnected).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
    expect(share.mock.calls[0][0].files[0].name).toBe("wordink-top-three.png");
  });
});

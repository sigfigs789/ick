import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBlob } from "html-to-image";
import { AchievementShareButton } from "./AchievementShareButton";

vi.mock("html-to-image", () => ({ toBlob: vi.fn() }));

const achievement = {
  id: "first-word",
  title: "First Word",
  description: "Play your first word.",
  icon: "🌱",
  group: "Getting started",
  word: "ember",
} as never;

describe("AchievementShareButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares the rendered card as an image through the share sheet", async () => {
    vi.mocked(toBlob).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { canShare: () => true, share });
    render(<AchievementShareButton achievement={achievement} />);
    await userEvent.click(screen.getByRole("button", { name: /share the first word/i }));
    expect(await screen.findByText("Shared!")).toBeInTheDocument();
    const node = vi.mocked(toBlob).mock.calls[0][0] as HTMLElement;
    expect(node.textContent).toContain("First Word");
    expect(node.textContent).toContain("WordInk");
    expect(node.textContent).not.toMatch(/http|\.com/);
    expect(share.mock.calls[0][0].files[0].type).toBe("image/png");
  });
});

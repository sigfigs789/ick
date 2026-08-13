import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SoundToggle } from "./SoundToggle";

describe("SoundToggle", () => {
  it("exposes the current sound state and toggles it", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<SoundToggle enabled onToggle={onToggle} />);
    const toggle = screen.getByRole("button", { name: /mute sound effects/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<SoundToggle enabled={false} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: /unmute sound effects/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

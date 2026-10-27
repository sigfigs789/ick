import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "./ShareButton";

describe("ShareButton", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "execCommand");
    writeText.mockReset();
  });

  it("copies the supplied text, reports success, and records the share", async () => {
    const onShared = vi.fn();
    render(<ShareButton text="WordInk result" onShared={onShared} />);

    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(writeText).toHaveBeenCalledWith("WordInk result");
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
    expect(onShared).toHaveBeenCalledTimes(1);
  });

  it("uses the manual-copy fallback when clipboard writing fails", async () => {
    writeText.mockRejectedValue(new Error("permission denied"));
    const execCopy = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCopy, configurable: true });
    render(<ShareButton text="WordInk result" />);

    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(execCopy).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("burns all over in its tier's colour, taller each tier up, without changing its name", () => {
    const { container, rerender } = render(<ShareButton text="x" />);
    expect(container.querySelector(".share-flames")).toBeNull();

    rerender(<ShareButton text="x" flames="Elusive" />);
    const button = screen.getByRole("button", { name: "Share" });
    expect(button).toHaveClass("share-flames-host", "share-flames--elusive", "share-flames--1");
    const tongues = container.querySelectorAll(".share-flames__tongue").length;
    expect(tongues).toBeGreaterThan(10);

    rerender(<ShareButton text="x" flames="Legend" />);
    expect(button).toHaveClass("share-flames--legend", "share-flames--3");
    expect(button).not.toHaveClass("share-flames--1");
    // The same row of tongues along the top edge; the tier sets their height.
    expect(container.querySelectorAll(".share-flames__tongue")).toHaveLength(tongues);
  });
});

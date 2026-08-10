import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toBlob } from "html-to-image";
import { ShareImageButton } from "./ShareImageButton";

vi.mock("html-to-image", () => ({
  toBlob: vi.fn(),
}));

function Harness({ spoilerFree }: { spoilerFree: boolean }) {
  const ref = createRef<HTMLDivElement>();
  return (
    <div>
      <div ref={ref}>
        <span className="results-panel__word">strange</span>
        <span className="rarity-badge">COMMON</span>
      </div>
      <ShareImageButton targetRef={ref} spoilerFree={spoilerFree} />
    </div>
  );
}

/** A promise plus its resolver, so a test can control exactly when `toBlob` settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("ShareImageButton", () => {
  const originalClipboard = navigator.clipboard;
  const writeMock = vi.fn<(items: ClipboardItem[]) => Promise<void>>(async () => undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { write: writeMock },
      configurable: true,
    });
    // jsdom has no Web Share API by default -- explicitly absent so the
    // clipboard fallback path is exercised.
    // @ts-expect-error -- test-only removal of an optional browser API
    delete navigator.canShare;
    // @ts-expect-error -- test-only removal of an optional browser API
    delete navigator.share;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    writeMock.mockClear();
    vi.mocked(toBlob).mockReset();
  });

  it("blurs word text (not rarity badges) only for the duration of the capture", async () => {
    const capture = deferred<Blob>();
    vi.mocked(toBlob).mockReturnValue(capture.promise);

    render(<Harness spoilerFree={true} />);
    const word = document.querySelector(".results-panel__word")!;
    const badge = document.querySelector(".rarity-badge")!;
    const user = userEvent.setup();

    void user.click(screen.getByRole("button"));
    await vi.waitFor(() => expect(word).toHaveClass("spoiler-blur"));
    expect(badge).not.toHaveClass("spoiler-blur");

    capture.resolve(new Blob(["fake-png"], { type: "image/png" }));
    await vi.waitFor(() => expect(word).not.toHaveClass("spoiler-blur"));
  });

  it("does not blur anything when spoilerFree is false", async () => {
    vi.mocked(toBlob).mockResolvedValue(new Blob(["fake-png"], { type: "image/png" }));
    render(<Harness spoilerFree={false} />);
    await userEvent.click(screen.getByRole("button"));
    expect(document.querySelector(".spoiler-blur")).toBeNull();
  });

  it("falls back to copying the image to the clipboard when Web Share is unavailable", async () => {
    vi.mocked(toBlob).mockResolvedValue(new Blob(["fake-png"], { type: "image/png" }));
    render(<Harness spoilerFree={false} />);
    await userEvent.click(screen.getByRole("button"));

    expect(writeMock).toHaveBeenCalledTimes(1);
    const items = writeMock.mock.calls[0][0];
    expect(items[0].types).toContain("image/png");

    expect(await screen.findByRole("button", { name: /image copied/i })).toBeInTheDocument();
  });
});

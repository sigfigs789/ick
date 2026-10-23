import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageErrorBoundary } from "./PageErrorBoundary";

function Broken(): JSX.Element {
  throw new Error("chunk gone");
}

beforeEach(() => {
  // React and the boundary both log the error; it is the point of the test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PageErrorBoundary", () => {
  it("keeps what is around it and offers a reload when the page throws", () => {
    render(
      <>
        <header>WordInk</header>
        <PageErrorBoundary resetKey="leaderboard">
          <Broken />
        </PageErrorBoundary>
      </>,
    );
    expect(screen.getByText("WordInk")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this page.");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("tries again when the route changes", () => {
    const { rerender } = render(
      <PageErrorBoundary resetKey="leaderboard">
        <Broken />
      </PageErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(
      <PageErrorBoundary resetKey="game">
        <p>the puzzle</p>
      </PageErrorBoundary>,
    );
    expect(screen.getByText("the puzzle")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

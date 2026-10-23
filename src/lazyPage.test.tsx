import { Component, Suspense, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lazyPage, type LazyPage } from "./lazyPage";

/** Shows what the page threw, so a let-through failure is observable. */
class Catch extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <p>failed</p> : this.props.children;
  }
}

function renderPage(Page: LazyPage) {
  render(
    <Catch>
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </Catch>,
  );
}

beforeEach(() => {
  // React logs the error a boundary catches; it is the point of one test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lazyPage", () => {
  it("renders the component picked out of the loaded module", async () => {
    const Page = lazyPage(
      async () => ({ ThePage: () => <p>the page</p> }),
      (m) => m.ThePage,
    );
    renderPage(Page);
    expect(await screen.findByText("the page")).toBeInTheDocument();
  });

  it("holds on the fallback when the import resolves to nothing, as it does while chunkRecovery reloads", async () => {
    const Page = lazyPage(
      async () => undefined as unknown as { ThePage: () => null },
      (m) => m.ThePage,
    );
    renderPage(Page);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });

  it("lets a failed import through to the error boundary", async () => {
    const Page = lazyPage(
      () => Promise.reject(new Error("still broken")),
      () => () => null,
    );
    renderPage(Page);
    expect(await screen.findByText("failed")).toBeInTheDocument();
  });

  it("shares one fetch between preload and the first render", async () => {
    const load = vi.fn(async () => ({ ThePage: () => <p>the page</p> }));
    const Page = lazyPage(load, (m) => m.ThePage);
    Page.preload();
    renderPage(Page);
    expect(await screen.findByText("the page")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed preload", async () => {
    const load = vi
      .fn<() => Promise<{ ThePage: () => JSX.Element }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ThePage: () => <p>the page</p> });
    const Page = lazyPage(load, (m) => m.ThePage);
    Page.preload();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderPage(Page);
    expect(await screen.findByText("the page")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

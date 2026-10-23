import { Component, Suspense, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lazyPage } from "./lazyPage";

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

function renderPage(Page: ReturnType<typeof lazyPage>) {
  render(
    <Catch>
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </Catch>,
  );
}

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  vi.stubGlobal("location", { ...window.location, reload });
  // React logs the error a boundary catches; it is the point of one test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the tab when the chunk fails to arrive", async () => {
    const Page = lazyPage(
      () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
      () => () => null,
    );
    renderPage(Page);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // Held on the fallback while the reload happens, not thrown.
    expect(screen.getByText("loading")).toBeInTheDocument();
  });

  it("lets a second failure through rather than reloading in a loop", async () => {
    sessionStorage.setItem("ick:chunk-reload-at", String(Date.now()));
    const Page = lazyPage(
      () => Promise.reject(new Error("still broken")),
      () => () => null,
    );
    renderPage(Page);
    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});

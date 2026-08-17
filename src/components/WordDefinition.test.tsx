import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordDefinition } from "./WordDefinition";

function mockDatamuse(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as Response);
}

describe("WordDefinition", () => {
  beforeEach(() => {
    // Each test uses a distinct word so the module-level definition cache
    // never serves a value fetched by an earlier test.
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and shows the definition, part of speech first", async () => {
    const fetchMock = mockDatamuse([{ defs: ["n\ta burrowing mammal"] }]);
    vi.stubGlobal("fetch", fetchMock);

    render(<WordDefinition word="aardvark" />);
    await userEvent.click(screen.getByRole("button", { name: /show definition/i }));

    expect(await screen.findByText(/a burrowing mammal/)).toBeInTheDocument();
    expect(screen.getByText("noun")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("sp=aardvark");
  });

  it("toggles closed and reopens without re-fetching", async () => {
    const fetchMock = mockDatamuse([{ defs: ["v\tto test"] }]);
    vi.stubGlobal("fetch", fetchMock);

    render(<WordDefinition word="probeword" />);
    const button = screen.getByRole("button");

    await userEvent.click(button);
    expect(await screen.findByText(/to test/)).toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.queryByText(/to test/)).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(await screen.findByText(/to test/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a graceful message when no definition exists", async () => {
    vi.stubGlobal("fetch", mockDatamuse([{}]));

    render(<WordDefinition word="nodefword" />);
    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByText(/no definition found/i)).toBeInTheDocument();
  });

  it("shows an error message when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<WordDefinition word="errorword" />);
    await userEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByText(/couldn't load the definition/i)).toBeInTheDocument(),
    );
  });
});

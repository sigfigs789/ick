import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IdleHintSection } from "./IdleHintSection";
import { twoProportionP } from "./analyticsFormat";

const arm = (over: Record<string, unknown> = {}) => ({
  assigned: 200,
  triggered: 100,
  typed: 60,
  guessed: 40,
  words: 80,
  bestScore: 280,
  finished: 20,
  shared: 10,
  usedHint: 0,
  medianVisibleMs: 95_000,
  returned: { cohort: 100, returned: 30, soFar: 32 },
  ...over,
});

const REPORT = {
  today: "2026-10-16",
  from: "2026-10-10",
  to: "2026-10-16",
  since: "2026-10-10",
  experiments: {
    new: { control: arm(), treatment: arm({ guessed: 60, usedHint: 25 }) },
    returning: { control: arm(), treatment: arm() },
  },
};

function stubFetch(report: unknown) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
    report === null
      ? new Response("nope", { status: 502 })
      : new Response(JSON.stringify({ report }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IdleHintSection", () => {
  it("asks for the window it is given, and tables each experiment arm against arm", async () => {
    const fetchMock = stubFetch(REPORT);
    render(<IdleHintSection from="2026-10-10" to="2026-10-16" today="2026-10-16" />);

    const table = (await screen.findByText("New players, after 5s")).closest("table") as HTMLElement;
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "list=idle-hint&from=2026-10-10&to=2026-10-16&today=2026-10-16",
    );
    expect(screen.getByText("Returning players, after 5s")).toBeInTheDocument();

    const guessed = within(table).getByRole("row", { name: /guessed after/i });
    expect(guessed).toHaveTextContent("40 40%");
    expect(guessed).toHaveTextContent("60 60%");
    expect(guessed).toHaveTextContent(`+20.0 pts (p ${twoProportionP(60, 100, 40, 100)!.toFixed(3)})`);
    expect(within(table).getByRole("row", { name: /words per player/i })).toHaveTextContent("0.80");
    expect(within(table).getByRole("row", { name: /median time/i })).toHaveTextContent("95s");
  });

  it("says so when its numbers cannot be loaded", async () => {
    stubFetch(null);
    render(<IdleHintSection from={null} to="2026-10-16" today="2026-10-16" />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});

describe("twoProportionP", () => {
  it("matches the textbook two-proportion z-test", () => {
    // 60/100 vs 40/100: z = 2.828, two-sided p = 0.00468.
    expect(twoProportionP(60, 100, 40, 100)).toBeCloseTo(0.00468, 4);
    expect(twoProportionP(50, 100, 50, 100)).toBeCloseTo(1, 6);
  });

  it("says nothing about an empty arm or a rate of 0 or 1", () => {
    expect(twoProportionP(0, 0, 4, 10)).toBeNull();
    expect(twoProportionP(0, 10, 0, 10)).toBeNull();
    expect(twoProportionP(10, 10, 10, 10)).toBeNull();
  });
});

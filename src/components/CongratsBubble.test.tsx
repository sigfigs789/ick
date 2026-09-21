import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CongratsBubble } from "./CongratsBubble";
import { handleFor } from "../game/handle";

const ALICE = "11111111-1111-4111-8111-111111111111";
// 2026-09-15 is a Tuesday: the week that closed began on the 6th.
const TUESDAY = "2026-09-15";
const LAST_WEEK = "2026-09-06";
// The second of a month, whose winner is August's.
const SECOND = "2026-09-02";

const WINNER = {
  rank: 1,
  playerId: ALICE,
  windowWord: "quixotic",
  windowZipf: 2.33,
  score: 41.2,
  puzzles: 5,
};

/** Answer the boards fetch, recording what was asked for. */
function stubFetch(body: { weekly?: unknown[]; allTime?: unknown[] } = {}) {
  const asked: string[] = [];
  const fetchMock = vi.fn(async (url: unknown) => {
    asked.push(String(url));
    return new Response(
      JSON.stringify({
        weekStart: "",
        daily: [],
        weekly: body.weekly ?? [],
        allTime: body.allTime ?? [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, asked };
}

/** The window one recorded request was about. */
function params(url: string) {
  return new URL(url, "https://wordink.app").searchParams;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the congratulation bubble", () => {
  it("names last week's winner on a Tuesday, and asks for the week that closed", async () => {
    const { asked } = stubFetch({ weekly: [WINNER] });
    render(<CongratsBubble today={TUESDAY} />);

    expect(
      await screen.findByRole("button", {
        name: `Congrats ${handleFor(ALICE)} for last week's win`,
      }),
    ).toBeInTheDocument();
    // The window nothing else on the page is showing: the Sunday nine days
    // back, not the one the live board is counting from.
    expect(params(asked[0]).get("since")).toBe(LAST_WEEK);
  });

  it("names last month's winner on the second, by the month's own name", async () => {
    const { asked } = stubFetch({ allTime: [WINNER] });
    render(<CongratsBubble today={SECOND} />);

    expect(
      await screen.findByRole("button", {
        name: `Congrats ${handleFor(ALICE)} on August's win`,
      }),
    ).toBeInTheDocument();
    expect(params(asked[0]).get("month")).toBe("2026-08-01");
  });

  it("says nothing, and asks nothing, on an ordinary day", async () => {
    const { fetchMock } = stubFetch({ weekly: [WINNER] });
    // A Wednesday, in the middle of a month.
    render(<CongratsBubble today="2026-09-16" />);

    await Promise.resolve();
    expect(screen.queryByRole("button")).toBeNull();
    // The days with nothing to celebrate are almost all of them, and they cost
    // the server nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays quiet when nobody scored in the window that closed", async () => {
    stubFetch({ weekly: [] });
    render(<CongratsBubble today={TUESDAY} />);

    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("pops off the page when it is pressed, and does not come back", async () => {
    stubFetch({ weekly: [WINNER] });
    const { unmount } = render(<CongratsBubble today={TUESDAY} />);

    await userEvent.click(await screen.findByRole("button"));
    // The pop plays and then the bubble is gone -- there is nothing left to
    // dismiss and nothing to press twice.
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());

    // Popped is remembered, so opening the page again later in the day is not a
    // second congratulation for the same week.
    unmount();
    render(<CongratsBubble today={TUESDAY} />);
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
});

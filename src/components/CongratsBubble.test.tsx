import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CongratsBubble } from "./CongratsBubble";
import { handleFor } from "../game/handle";

const ALICE = "11111111-1111-4111-8111-111111111111";
// 2026-09-14 is a Monday: the week that closed began on the 6th. It is also
// past the fifth, so the month is not owed anything and the week is the only
// congratulation in play.
const MONDAY = "2026-09-14";
const LAST_WEEK = "2026-09-06";
// The second of a month, whose winner is August's.
const SECOND = "2026-09-02";
// A Monday after the split: the week that closed has a board per mode.
const SPLIT_MONDAY = "2026-10-12";

const WINNER = {
  rank: 1,
  playerId: ALICE,
  windowWord: "quixotic",
  windowZipf: 2.33,
  score: 41.2,
  puzzles: 5,
};

type Body = { weekly?: unknown[]; allTime?: unknown[] };

/**
 * Answer the boards fetch, recording what was asked for. A function answers
 * per mode, for the windows that have one board each.
 */
function stubFetch(answer: Body | ((mode: string) => Body) = {}) {
  const asked: string[] = [];
  const fetchMock = vi.fn(async (url: unknown) => {
    asked.push(String(url));
    const body =
      typeof answer === "function" ? answer(params(String(url)).get("mode") ?? "") : answer;
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

beforeEach(() => {
  localStorage.clear();
  // A player who has been around since the summer, so is owed the month's.
  localStorage.setItem(
    "ick:progress:2026-07-15",
    JSON.stringify({ date: "2026-07-15", acceptedWords: [{ word: "quixotic" }] }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the congratulation bubble", () => {
  it("names last week's winner on a Monday, and asks for the week that closed", async () => {
    const { asked } = stubFetch({ weekly: [WINNER] });
    render(<CongratsBubble today={MONDAY} />);

    expect(
      await screen.findByRole("button", {
        name: `Congrats ${handleFor(ALICE)} for last week's Standard win`,
      }),
    ).toBeInTheDocument();
    // The window nothing else on the page is showing: the Sunday eight days
    // back, not the one the live board is counting from.
    expect(params(asked[0]).get("since")).toBe(LAST_WEEK);
    expect(params(asked[0]).get("mode")).toBe("standard");
  });

  it("floats the Standard and Freeform winners at once, whatever mode is on", async () => {
    // A Monday after the split, so last week has a winner on each board -- and
    // the reader is on Standard, which does not keep Freeform's from them.
    localStorage.setItem("ick:mode", "standard");
    const BOB = "22222222-2222-4222-8222-222222222222";
    const { asked } = stubFetch((mode) => ({
      weekly: [{ ...WINNER, playerId: mode === "freeform" ? BOB : ALICE }],
    }));
    const { container } = render(<CongratsBubble today={SPLIT_MONDAY} />);

    const standard = await screen.findByRole("button", {
      name: `Congrats ${handleFor(ALICE)} for last week's Standard win`,
    });
    const freeform = await screen.findByRole("button", {
      name: `Congrats ${handleFor(BOB)} for last week's Freeform win`,
    });
    expect(asked.map((url) => params(url).get("mode")).sort()).toEqual(["freeform", "standard"]);
    expect(asked.every((url) => params(url).get("since") === "2026-10-04")).toBe(true);

    // Each spawns at a point of its own.
    const spawns = [...container.querySelectorAll<HTMLElement>(".congrats-bubble__drift")].map(
      (drift) => `${drift.style.getPropertyValue("--wander-x0")} ${drift.style.getPropertyValue("--wander-y0")}`,
    );
    expect(new Set(spawns).size).toBe(2);

    // Popping one leaves the other floating.
    await userEvent.click(standard);
    expect(freeform).toBeInTheDocument();
  });

  it("names no month's winner to a player who was not around for it", async () => {
    localStorage.clear();
    const { asked } = stubFetch({ allTime: [WINNER] });
    render(<CongratsBubble today={SECOND} />);

    // 2026-09-02 is a Wednesday, so last week's is still owed -- only the month
    // is held back.
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(params(asked[0]).get("since")).toBe("2026-08-23");
  });

  it("skips straight to the Freeform winner when nobody played Standard", async () => {
    stubFetch((mode) => ({ weekly: mode === "freeform" ? [WINNER] : [] }));
    render(<CongratsBubble today={SPLIT_MONDAY} />);

    expect(
      await screen.findByRole("button", {
        name: `Congrats ${handleFor(ALICE)} for last week's Freeform win`,
      }),
    ).toBeInTheDocument();
  });

  it("names last month's winner on the second, by the month's own name", async () => {
    const { asked } = stubFetch({ allTime: [WINNER] });
    render(<CongratsBubble today={SECOND} />);

    expect(
      await screen.findByRole("button", {
        name: `Congrats ${handleFor(ALICE)} on August's Standard win`,
      }),
    ).toBeInTheDocument();
    expect(params(asked[0]).get("month")).toBe("2026-08-01");
  });

  it("says nothing, and asks nothing, on an ordinary day", async () => {
    const { fetchMock } = stubFetch({ weekly: [WINNER] });
    // A Friday, past both runs: the week's ended on Thursday and the month's
    // on the fifth.
    render(<CongratsBubble today="2026-09-18" />);

    await Promise.resolve();
    expect(screen.queryByRole("button")).toBeNull();
    // The days with nothing to celebrate are almost all of them, and they cost
    // the server nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still names last week's winner to a player whose first visit is Thursday", async () => {
    // The whole point of the run: a bubble that only ever appeared on the
    // Monday would miss everybody who did not open the boards on the Monday.
    stubFetch({ weekly: [WINNER] });
    render(<CongratsBubble today="2026-09-17" />);

    expect(
      await screen.findByRole("button", {
        name: `Congrats ${handleFor(ALICE)} for last week's Standard win`,
      }),
    ).toBeInTheDocument();
  });

  it("stays quiet when nobody scored in the window that closed", async () => {
    stubFetch({ weekly: [] });
    render(<CongratsBubble today={MONDAY} />);

    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("splats into ink when it is hit, and the ink soaks away", async () => {
    stubFetch({ weekly: [WINNER] });
    const { container, unmount } = render(<CongratsBubble today={MONDAY} />);

    await userEvent.click(await screen.findByRole("button"));
    // The bubble is gone the moment it is hit, and what is left is the blot --
    // decorative, so it is asserted by class rather than by role.
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".congrats-bubble__splat")).not.toBeNull();

    // And then the ink goes too: there is nothing left to dismiss and nothing
    // to press twice.
    await waitFor(
      () => expect(container.querySelector(".congrats-bubble__splat")).toBeNull(),
      { timeout: 3000 },
    );

    // Popped is remembered, so opening the page again -- later that day or on
    // the Thursday -- is not a second congratulation for the same week.
    unmount();
    render(<CongratsBubble today="2026-09-17" />);
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
});

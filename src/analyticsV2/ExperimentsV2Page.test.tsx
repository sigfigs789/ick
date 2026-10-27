import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExperimentsV2Page } from "./ExperimentsV2Page";

vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => "2026-10-22",
}));

afterEach(() => vi.unstubAllGlobals());

/** The row for `measure` in the table captioned `table`. */
const rowOf = (table: string, measure: string) =>
  [...screen.getByRole("table", { name: table }).querySelectorAll("tr")].find(
    (tr) => tr.querySelector("th")?.textContent === measure,
  )!;

describe("ExperimentsV2Page", () => {
  it("draws the word of the day's call and its arms for everyone, new and returning players", async () => {
    const wordOfDay = {
      since: "2026-11-01",
      arms: [
        { variant: "shown", segment: "all", assigned: 320, d1: { cohort: 300, returned: 90 }, d7: { cohort: 200, returned: 20 } },
        { variant: "shown", segment: "new", assigned: 120, d1: { cohort: 100, returned: 20 }, d7: { cohort: 80, returned: 5 } },
        { variant: "hidden", segment: "all", assigned: 310, d1: { cohort: 300, returned: 60 }, d7: { cohort: 200, returned: 12 } },
        { variant: "hidden", segment: "new", assigned: 110, d1: { cohort: 100, returned: 10 }, d7: { cohort: 80, returned: 4 } },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ wordOfDay, comeBack: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Word of the day" })).toBeTruthy();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("list=experiments-v2&today=2026-10-22");
    expect(screen.getByText("Keep the word of the day")).toBeTruthy();
    for (const name of ["Everyone", "New", "Returning"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    const everyone = rowOf("Everyone drawn: with the word of the day against without.", "D1 retention");
    expect(everyone.textContent).toContain("30%");
    expect(everyone.textContent).toContain("+10 pts *");
    // Returning is everyone less new: 70 of 200 shown (35%), 50 of 200 hidden (25%).
    const returning = rowOf("Returning players alone: drawn on a later day, who had played before. They stay returning for good.", "D1 retention");
    expect(returning.textContent).toContain("35%");
    expect(returning.textContent).toContain("70/200");
    expect(returning.textContent).toContain("25%");
    expect(rowOf("Returning players alone: drawn on a later day, who had played before. They stay returning for good.", "Players drawn").textContent).toBe(
      "Players drawn200200",
    );
    // Drawn only after a first word, so the arms cannot differ on activation; the row says so rather than show 100%.
    expect(rowOf("Everyone drawn: with the word of the day against without.", "Activation").textContent).toBe(
      "Activationn/an/a–",
    );
    expect(screen.queryByRole("heading", { name: "Come-back tip" })).toBeNull();
  });

  it("draws the come-back tip beside the word of the day", async () => {
    const comeBack = {
      since: "2026-11-01",
      arms: [
        { variant: "shown", segment: "all", assigned: 320, d1: { cohort: 300, returned: 60 } },
        { variant: "hidden", segment: "all", assigned: 310, d1: { cohort: 300, returned: 90 } },
      ],
    };
    const body = { wordOfDay: { since: null, arms: [] }, comeBack };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Come-back tip" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Word of the day" })).toBeTruthy();
    expect(screen.getByText("Remove the come-back tip")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Everyone drawn: with the come-back tip against without." })).toBeTruthy();
  });

  it("counts everyone drawn since it started, then the players drawn in a picked window", async () => {
    const drawn = (assigned: number) => ({
      since: "2026-10-01",
      arms: [
        { variant: "shown", segment: "all", assigned, d1: { cohort: 0, returned: 0 } },
        { variant: "hidden", segment: "all", assigned, d1: { cohort: 0, returned: 0 } },
      ],
    });
    const fetchMock = vi.fn(async (url: string) => {
      const from = new URL(url, "http://x").searchParams.get("from");
      const body = { wordOfDay: drawn(from === "2026-10-15" ? 7 : from === "2026-10-22" ? 3 : 50), comeBack: null };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ExperimentsV2Page />);
    const playersDrawn = () => rowOf("Everyone drawn: with the word of the day against without.", "Players drawn").textContent;

    await screen.findByRole("heading", { name: "Word of the day" });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("from=");
    expect(screen.getByRole("button", { name: "Since it started" }).getAttribute("aria-pressed")).toBe("true");
    expect(playersDrawn()).toBe("Players drawn5050");

    fireEvent.click(screen.getByRole("button", { name: "Past 7 days" }));
    await waitFor(() => expect(playersDrawn()).toBe("Players drawn77"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("&from=2026-10-15&to=2026-10-21"))).toBe(true);
    expect(screen.getByText(/Players drawn: Past 7 days\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(playersDrawn()).toBe("Players drawn33"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("&from=2026-10-22&to=2026-10-22"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Since it started" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("&from=2026-10-10&to=2026-10-22"))).toBe(true),
    );
  });

  it("draws the header celebrations test, new and returning players apart", async () => {
    const headerCelebrations = {
      since: "2026-10-26",
      arms: [
        { variant: "shown", segment: "all", assigned: 300, d1: { cohort: 280, returned: 90 } },
        { variant: "shown", segment: "new", assigned: 60, d1: { cohort: 55, returned: 15 } },
        { variant: "hidden", segment: "all", assigned: 100, d1: { cohort: 95, returned: 25 } },
        { variant: "hidden", segment: "new", assigned: 20, d1: { cohort: 18, returned: 5 } },
      ],
    };
    const body = { wordOfDay: null, comeBack: null, headerCelebrations };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Header celebrations" })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Everyone drawn: with the header celebrations against without." }),
    ).toBeTruthy();
    // Everyone, then new players, then returning players.
    expect(screen.getAllByRole("table")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Returning" })).toBeTruthy();
  });

  it("draws the share name test, new and returning players apart", async () => {
    const shareName = {
      since: "2026-10-26",
      arms: [
        { variant: "shown", segment: "all", assigned: 200, d1: { cohort: 180, returned: 60 } },
        { variant: "shown", segment: "new", assigned: 80, d1: { cohort: 70, returned: 20 } },
        { variant: "hidden", segment: "all", assigned: 200, d1: { cohort: 180, returned: 55 } },
        { variant: "hidden", segment: "new", assigned: 90, d1: { cohort: 80, returned: 20 } },
      ],
    };
    const body = { wordOfDay: null, comeBack: null, headerCelebrations: null, shareName };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Username in shares" })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Everyone drawn: with the username in shares against without." }),
    ).toBeTruthy();
    // Everyone, then new players, then returning players.
    expect(screen.getAllByRole("table")).toHaveLength(3);
  });

  it("draws the input placement test, new and returning players apart", async () => {
    const inputPlacement = {
      since: "2026-10-26",
      arms: [
        { variant: "shown", segment: "all", assigned: 200, d1: { cohort: 180, returned: 60 } },
        { variant: "shown", segment: "new", assigned: 80, d1: { cohort: 70, returned: 20 } },
        { variant: "hidden", segment: "all", assigned: 200, d1: { cohort: 180, returned: 55 } },
        { variant: "hidden", segment: "new", assigned: 90, d1: { cohort: 80, returned: 20 } },
      ],
    };
    const body = { wordOfDay: null, comeBack: null, headerCelebrations: null, shareName: null, inputPlacement };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Input below the guess log" })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Everyone drawn: with the input below the guess log against without." }),
    ).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(3);
  });

  it("draws the play tab test, new and returning players apart", async () => {
    const playTab = {
      since: "2026-10-26",
      arms: [
        { variant: "shown", segment: "all", assigned: 50, d1: { cohort: 45, returned: 15 } },
        { variant: "shown", segment: "new", assigned: 20, d1: { cohort: 18, returned: 5 } },
        { variant: "hidden", segment: "all", assigned: 200, d1: { cohort: 180, returned: 55 } },
        { variant: "hidden", segment: "new", assigned: 90, d1: { cohort: 80, returned: 20 } },
      ],
    };
    const body = {
      wordOfDay: null,
      comeBack: null,
      headerCelebrations: null,
      shareName: null,
      inputPlacement: null,
      playTab,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Play icon in the header" })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Everyone drawn: with the Play icon in the header against without." }),
    ).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(3);
  });

  it("draws the share flames test, new and returning players apart", async () => {
    const shareFlames = {
      since: "2026-10-28",
      arms: [
        { variant: "shown", segment: "all", assigned: 60, d1: { cohort: 50, returned: 20 } },
        { variant: "shown", segment: "new", assigned: 25, d1: { cohort: 20, returned: 6 } },
        { variant: "hidden", segment: "all", assigned: 58, d1: { cohort: 49, returned: 18 } },
        { variant: "hidden", segment: "new", assigned: 24, d1: { cohort: 21, returned: 6 } },
      ],
    };
    const body = {
      wordOfDay: null,
      comeBack: null,
      headerCelebrations: null,
      shareName: null,
      inputPlacement: null,
      playTab: null,
      shareFlames,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Share buttons on fire" })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Everyone drawn: with the burning Share buttons against without." }),
    ).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(3);
  });

  it("says so when the database sent no experiment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ wordOfDay: null, comeBack: null }), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByText("No experiment is running.")).toBeTruthy();
  });
});

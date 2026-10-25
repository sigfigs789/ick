import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    const returning = rowOf("Returning players alone: drawn on a later day, who had played before.", "D1 retention");
    expect(returning.textContent).toContain("35%");
    expect(returning.textContent).toContain("70/200");
    expect(returning.textContent).toContain("25%");
    expect(rowOf("Returning players alone: drawn on a later day, who had played before.", "Players drawn").textContent).toBe(
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

  it("draws the header celebrations test", async () => {
    const headerCelebrations = {
      since: "2026-10-26",
      arms: [
        { variant: "shown", segment: "all", assigned: 300, d1: { cohort: 280, returned: 90 } },
        { variant: "hidden", segment: "all", assigned: 100, d1: { cohort: 95, returned: 25 } },
      ],
    };
    const body = { wordOfDay: null, comeBack: null, headerCelebrations };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByRole("heading", { name: "Header celebrations" })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Everyone drawn: with the header celebrations against without." }),
    ).toBeTruthy();
  });

  it("says so when the database sent no experiment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ wordOfDay: null, comeBack: null }), { status: 200 })));
    render(<ExperimentsV2Page />);

    expect(await screen.findByText("No experiment is running.")).toBeTruthy();
  });
});

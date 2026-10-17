import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitForm } from "./SubmitForm";
import { idleHintText, idleHintWords } from "../game/idleHint";
import { recordVisit } from "../game/visits";
import type { AcceptedWord } from "../game/types";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));
const playKeystroke = vi.hoisted(() => vi.fn());
vi.mock("../audio/sound", () => ({ playKeystroke }));

const DATE = "2026-10-17";
const DROP = "str";
const HINTS = idleHintWords(DROP, DATE, []);
const [HINT] = HINTS;
const DEFAULT = "type a word…";
/** Typing a hint out, holding it and erasing it, end to end. */
const showMs = (word: string) => idleHintText(word).length * (70 + 45) + 3_500;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  track.mockClear();
  playKeystroke.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  document.querySelectorAll("[aria-modal]").forEach((el) => el.remove());
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

function inArm(experiment: "new" | "returning", variant: "control" | "treatment") {
  if (experiment === "returning") {
    recordVisit("", "2026-10-16");
    sessionStorage.clear();
  }
  localStorage.setItem("ick:idle-hint", JSON.stringify({ [experiment]: variant }));
}

function renderForm(props: { acceptedWords?: AcceptedWord[]; onSubmit?: () => unknown } = {}) {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue({ ok: true });
  render(
    <SubmitForm
      drop={DROP}
      disabled={false}
      feedback={null}
      onSubmit={onSubmit as never}
      date={DATE}
      acceptedWords={props.acceptedWords ?? []}
    />
  );
  return screen.getByLabelText(/enter a word containing "STR"/i) as HTMLInputElement;
}

function events(name: string) {
  return track.mock.calls.filter(([n]) => n === name).map(([, props]) => props);
}

/** Advances in small steps, so each timer the loop sets on a render gets to run. */
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 10) {
    await act(async () => {
      vi.advanceTimersByTime(Math.min(10, left));
    });
  }
}

/** Steps until `done` holds, and says how long that took. */
async function until(done: () => boolean, max = 60_000): Promise<number> {
  let elapsed = 0;
  while (!done()) {
    if (elapsed >= max) throw new Error(`still waiting after ${max}ms`);
    await wait(10);
    elapsed += 10;
  }
  return elapsed;
}

describe("the idle hint", () => {
  it("types three words into the placeholder, 7 seconds apart, then stops", async () => {
    inArm("new", "treatment");
    const input = renderForm();
    expect(HINTS).toHaveLength(3);

    await wait(6_900);
    expect(input.placeholder).toBe(DEFAULT);
    expect(events("idle_hint_triggered")).toHaveLength(0);

    await wait(100);
    expect(events("idle_hint_triggered")).toEqual([
      expect.objectContaining({
        experiment: "new",
        variant: "treatment",
        shown: true,
        delay_ms: 7_000,
        word: HINT.word,
        words: HINTS.map((w) => w.word).join(","),
        rarity: HINT.rarity,
        puzzle_date: DATE,
      }),
    ]);

    // A character at a time.
    await wait(80);
    expect(input.placeholder).toBe(".");
    for (const [i, hint] of HINTS.entries()) {
      const text = idleHintText(hint.word);
      if (i > 0) {
        // Seven seconds of an empty box between hints.
        const gap = await until(() => input.placeholder !== DEFAULT);
        expect(gap).toBeGreaterThanOrEqual(7_000);
        expect(gap).toBeLessThan(7_200);
      }
      const typing = await until(() => input.placeholder === text);
      expect(typing).toBeGreaterThanOrEqual((text.length - 2) * 70);
      // Held for 3.5 seconds, then erased a character at a time.
      const held = await until(() => input.placeholder !== text);
      expect(held).toBeGreaterThanOrEqual(3_500);
      expect(held).toBeLessThan(3_700);
      expect(input.placeholder).toBe(text.slice(0, -1));
      await until(() => input.placeholder === DEFAULT, text.length * 45 + 200);
    }
    // A key sound for every character typed and every one erased.
    const keys = HINTS.reduce((n, w) => n + idleHintText(w.word).length * 2, 0);
    expect(playKeystroke).toHaveBeenCalledTimes(keys);

    // And that is all.
    await wait(30_000);
    expect(input.placeholder).toBe(DEFAULT);
    expect(playKeystroke).toHaveBeenCalledTimes(keys);
    expect(events("idle_hint_triggered")).toHaveLength(1);
  });

  it("ends the loop for the puzzle on the first letter typed", async () => {
    inArm("new", "treatment");
    const input = renderForm();

    await wait(7_000 + 500);
    expect(input.placeholder).not.toBe(DEFAULT);
    fireEvent.change(input, { target: { value: "s" } });
    expect(events("idle_hint_typed")).toEqual([
      expect.objectContaining({ variant: "treatment", ms_after_trigger: 500 }),
    ]);

    fireEvent.change(input, { target: { value: "" } });
    expect(input.placeholder).toBe(DEFAULT);
    const keys = playKeystroke.mock.calls.length;
    await wait(60_000);
    expect(input.placeholder).toBe(DEFAULT);
    expect(playKeystroke).toHaveBeenCalledTimes(keys);
    expect(events("idle_hint_triggered")).toHaveLength(1);
  });

  it("keeps the clock going, and types the hint, while the box is focused", async () => {
    inArm("new", "treatment");
    const input = renderForm();

    await wait(5_000);
    act(() => input.focus());
    fireEvent.focus(input);
    expect(document.activeElement).toBe(input);
    await wait(2_000);
    expect(events("idle_hint_triggered")).toHaveLength(1);
    await wait(idleHintText(HINT.word).length * 70 + 20);
    expect(input.placeholder).toBe(idleHintText(HINT.word));
  });

  it("holds the clock while a dialog is open and starts it once the dialog closes", async () => {
    inArm("new", "treatment");
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    renderForm();

    await wait(20_000);
    expect(events("idle_hint_triggered")).toHaveLength(0);

    await act(async () => {
      dialog.remove();
    });
    await wait(6_900);
    expect(events("idle_hint_triggered")).toHaveLength(0);
    await wait(100);
    expect(events("idle_hint_triggered")).toHaveLength(1);
  });

  it("pauses the loop while a dialog is open", async () => {
    inArm("new", "treatment");
    const input = renderForm();

    await wait(7_000 + 210);
    const shown = input.placeholder;
    expect(shown).toBe("...");
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    await act(async () => {
      document.body.appendChild(dialog);
    });
    await wait(20_000);
    expect(input.placeholder).toBe(shown);

    await act(async () => {
      dialog.remove();
    });
    await wait(idleHintText(HINT.word).length * 70);
    expect(input.placeholder).toBe(idleHintText(HINT.word));
  });

  it("shows the hint to a forced treatment arm without storing or reporting it", async () => {
    window.history.replaceState(null, "", "/?idle-hint=treatment");
    const input = renderForm();

    await wait(7_000);
    await wait(idleHintText(HINT.word).length * 70 + 20);
    expect(input.placeholder).toBe(idleHintText(HINT.word));
    expect(localStorage.getItem("ick:idle-hint")).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it("runs the same clock in control and reports it, but shows and plays nothing", async () => {
    inArm("new", "control");
    const input = renderForm();

    await wait(7_000);
    for (const hint of HINTS) {
      await wait(showMs(hint.word) + 100);
      expect(input.placeholder).toBe(DEFAULT);
      await wait(7_000);
    }
    expect(playKeystroke).not.toHaveBeenCalled();
    expect(events("idle_hint_triggered")).toEqual([
      expect.objectContaining({ experiment: "new", variant: "control", shown: false, word: HINT.word }),
    ]);
  });

  it("waits 10 seconds for a returning player", async () => {
    inArm("returning", "treatment");
    renderForm();

    await wait(9_900);
    expect(events("idle_hint_triggered")).toHaveLength(0);
    await wait(100);
    expect(events("idle_hint_triggered")).toEqual([
      expect.objectContaining({ experiment: "returning", delay_ms: 10_000 }),
    ]);
  });

  it("starts the clock over when the player types before it runs out", async () => {
    inArm("new", "treatment");
    const input = renderForm();

    await wait(5_000);
    fireEvent.change(input, { target: { value: "st" } });
    await wait(10_000);
    expect(events("idle_hint_triggered")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "" } });
    await wait(7_000);
    expect(events("idle_hint_triggered")).toHaveLength(1);
  });

  it("draws an arm on first sight and reports the draw once", async () => {
    renderForm();
    await wait(10);

    const stored = JSON.parse(localStorage.getItem("ick:idle-hint")!);
    expect(["control", "treatment"]).toContain(stored.new);
    expect(events("idle_hint_assigned")).toEqual([
      expect.objectContaining({ experiment: "new", variant: stored.new, puzzle_date: DATE }),
    ]);
  });

  it("reports a submitted hint word", async () => {
    inArm("new", "treatment");
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const input = renderForm({ onSubmit });

    await wait(7_000 + 1_500);
    fireEvent.change(input, { target: { value: HINT.word } });
    await act(async () => {
      fireEvent.submit(input.form!);
    });
    expect(onSubmit).toHaveBeenCalledWith(HINT.word);
    expect(events("idle_hint_word_submitted")).toEqual([
      expect.objectContaining({ word: HINT.word, accepted: true, variant: "treatment" }),
    ]);
  });

  it("stays out of a form that is not given the puzzle's words", async () => {
    render(<SubmitForm drop={DROP} disabled={false} feedback={null} onSubmit={vi.fn()} />);
    await wait(20_000);
    expect(localStorage.getItem("ick:idle-hint")).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});

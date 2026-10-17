import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitForm } from "./SubmitForm";
import { idleHintText, idleHintWord } from "../game/idleHint";
import { recordVisit } from "../game/visits";
import type { AcceptedWord } from "../game/types";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));
const playKeystroke = vi.hoisted(() => vi.fn());
vi.mock("../audio/sound", () => ({ playKeystroke }));

const DATE = "2026-10-17";
const DROP = "str";
const HINT = idleHintWord(DROP, DATE, [])!;

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

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** One render per typed character, so the chain of timers can advance. */
async function waitTyping(chars: number) {
  for (let i = 0; i < chars; i++) await wait(70);
}

describe("the idle hint", () => {
  it("types a word into the placeholder after 7 idle seconds for a new player in treatment", async () => {
    inArm("new", "treatment");
    const input = renderForm();

    await wait(6_900);
    expect(input.placeholder).toBe("type a word…");
    expect(events("idle_hint_triggered")).toHaveLength(0);

    await wait(100);
    expect(events("idle_hint_triggered")).toEqual([
      expect.objectContaining({
        experiment: "new",
        variant: "treatment",
        shown: true,
        delay_ms: 7_000,
        word: HINT.word,
        rarity: HINT.rarity,
        puzzle_date: DATE,
      }),
    ]);

    // A character at a time, emoji first.
    await wait(70);
    expect(input.placeholder).toBe("💡");
    await waitTyping(40);
    expect(input.placeholder).toBe(idleHintText(HINT.word));
    // A key sound for every character but the space.
    expect(playKeystroke).toHaveBeenCalledTimes(Array.from(idleHintText(HINT.word)).length - 1);
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
    await waitTyping(40);
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

  it("shows the hint to a forced treatment arm without storing or reporting it", async () => {
    window.history.replaceState(null, "", "/?idle-hint=treatment");
    const input = renderForm();

    await wait(7_000);
    await waitTyping(40);
    expect(input.placeholder).toBe(idleHintText(HINT.word));
    expect(localStorage.getItem("ick:idle-hint")).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it("runs the same clock in control and reports it, but shows nothing", async () => {
    inArm("new", "control");
    const input = renderForm();

    await wait(7_000);
    await waitTyping(40);
    expect(input.placeholder).toBe("type a word…");
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

  it("starts the clock over when the player types, and never fires while the box has a word in it", async () => {
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
    await wait(0);

    const stored = JSON.parse(localStorage.getItem("ick:idle-hint")!);
    expect(["control", "treatment"]).toContain(stored.new);
    expect(events("idle_hint_assigned")).toEqual([
      expect.objectContaining({ experiment: "new", variant: stored.new, puzzle_date: DATE }),
    ]);
  });

  it("reports the first keystroke after the hint, and a submitted hint word", async () => {
    inArm("new", "treatment");
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const input = renderForm({ onSubmit });

    await wait(7_000);
    await wait(1_500);
    fireEvent.change(input, { target: { value: HINT.word } });
    expect(events("idle_hint_typed")).toEqual([
      expect.objectContaining({ variant: "treatment", ms_after_trigger: 1_500 }),
    ]);

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

import { useCallback, useState, type ReactNode } from "react";
import { ReviewPage } from "../components/ReviewPage";
import { useReviewList } from "../components/reviewList";
import { todayDateString } from "../game/date";
import { fetchExperiments, type Experiments } from "./report";
import { ExperimentView } from "./ExperimentView";
import { describe, PAST_30, PAST_7, sameSpan, SINCE_START, spanOf, TODAY, type Choice } from "./window";
import { WindowPicker } from "./WindowPicker";

/**
 * The experiments, at /experimentsV2: each split test's call, then its arms for
 * everyone drawn, new players and returning players.
 *
 * Moved off /analyticsV2 onto their own read (`list=experiments-v2`), so this
 * page does not wait on the dashboard's report and the dashboard does not wait
 * on the experiments.
 *
 * The window picked at the top counts the players drawn in it, since the
 * experiment started unless picked otherwise. It chooses who is in the test,
 * not which of their days count: a player drawn on the window's last day is
 * still followed to their day 1 and day 7.
 *
 * Unlinked from the game and open without a key: every number is an aggregate.
 */
export function ExperimentsV2Page() {
  const today = todayDateString();
  const [choice, setChoice] = useState<Choice>(SINCE_START.choice);
  const span = spanOf(choice, today);
  const from = span?.from;
  const to = span?.to;
  const load = useCallback(
    async () => [await fetchExperiments(today, from && to ? { from, to } : undefined)],
    [today, from, to],
  );
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const experiments = rows[0];
  // Kept up while another window loads, as the window it was counted over.
  const picker = experiments && (
    <WindowPicker
      choice={choice}
      presets={PRESETS}
      today={today}
      counting={!sameSpan(experiments.span, span)}
      onChoose={setChoice}
    />
  );
  return (
    <ReviewPage
      title="Experiments v2"
      note="Whether each thing under test moves the scorecard, for everyone, new players and returning players."
      count={0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="No experiment is running."
      isEmpty={
        !experiments ||
        (!experiments.wordOfDay &&
          !experiments.comeBack &&
          !experiments.headerCelebrations &&
          !experiments.shareName &&
          !experiments.inputPlacement &&
          !experiments.playTab &&
          !experiments.idleHintNew &&
          !experiments.idleHintReturning)
      }
    >
      {picker}
      {experiments && <List experiments={experiments} today={today} />}
    </ReviewPage>
  );
}

const PRESETS = [SINCE_START, TODAY, PAST_7, PAST_30];

function List({ experiments, today }: { experiments: Experiments; today: string }) {
  const drawn = experiments.span ? ` Players drawn: ${describe(experiments.span, today)}.` : "";
  return (
    <div className="av2">
      {experiments.wordOfDay && (
        <Section
          title="Word of the day"
          note={`Whether showing the word of the day under a finished puzzle moves the scorecard. Over players.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.wordOfDay}
            subject="the word of the day"
            about={
              <>
                Half of players never see the word under a finished puzzle&rsquo;s drop. Each is drawn once, the first
                time they finish a puzzle. Try either arm with <code>?word-of-day=hidden</code> or <code>=shown</code>;
                a forced arm is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.comeBack && (
        <Section
          title="Come-back tip"
          note={`Whether the line under the streak saying what tomorrow is worth moves the scorecard. Over players.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.comeBack}
            subject="the come-back tip"
            about={
              <>
                One in three new draws never sees the line under the streak that says what tomorrow is worth (players
                drawn while the split was 50/50 keep their arm). Each is drawn once, the first time it would appear: a word banked on today&rsquo;s puzzle. Try either arm with{" "}
                <code>?come-back=hidden</code> or <code>=shown</code>; a forced arm, or a tester, is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.headerCelebrations && (
        <Section
          title="Header celebrations"
          note={`Whether the cards over the top of today's puzzle move the scorecard. Over players, new and returning apart.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.headerCelebrations}
            subject="the header celebrations"
            about={
              <>
                A quarter of players never see the header celebrations: no longest streak yet, climb up the streak
                board, yesterday&rsquo;s best word, perfect month or rising average. Each is drawn once, the first time
                one of those cards would show. Try either arm with <code>?header-celebrations=hidden</code> or{" "}
                <code>=shown</code>; a forced arm, or a tester, is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.shareName && (
        <Section
          title="Username in shares"
          note={`Whether a shared result saying who played it, by default, moves the scorecard. Over players, new and returning apart.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.shareName}
            subject="the username in shares"
            about={
              <>
                Half of players who have never set the share panel&rsquo;s &ldquo;Show username&rdquo; toggle start
                with it off, so their shares leave out &ldquo;Playing as&rdquo;; a player who has set it keeps their
                choice and is never drawn. Each is drawn once, the first time a share is built, and keeps the arm
                after setting the toggle; that switch is logged as <code>share_name_toggled</code>, the override
                rate for each arm. Watch the sharing guardrail here as closely as D1. Try either arm with{" "}
                <code>?share-name=hidden</code> or <code>=shown</code>; a forced arm, or a tester (forced to hidden),
                is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.inputPlacement && (
        <Section
          title="Input below the guess log"
          note={`Whether moving the guess input from under the drop to below the guess log moves the scorecard. Over players, new and returning apart.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.inputPlacement}
            drawnBeforeFirstWord
            subject="the input below the guess log"
            arms={{ shown: "Below", hidden: "Above" }}
            about={
              <>
                One in five new draws gets the input below the guess log; the rest keep it above. Each is drawn once,
                the first time the input appears. Try either arm with <code>?input-placement=below</code> or{" "}
                <code>=above</code>; a forced arm, or a tester, is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.playTab && (
        <Section
          title="Play icon in the header"
          note={`Whether a Play icon, first in the header, moves the scorecard. Over players, new and returning apart.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.playTab}
            drawnBeforeFirstWord
            subject="the Play icon in the header"
            about={
              <>
                One player in five gets a Play icon, the way back to the puzzle, first among the header&rsquo;s page
                icons; the rest have the wordmark alone, as before. Each is drawn once, on their first load. Try either
                arm with <code>?play-tab=shown</code> or <code>=hidden</code>; a forced arm, or a tester (forced to
                hidden), is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.idleHintNew && (
        <Section
          title="Idle hint, first sessions"
          note={`Whether typing a word into the empty box of a player sitting idle in their first session moves the scorecard. Over players who sat idle 7 seconds.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.idleHintNew}
            subject="the idle hint"
            arms={IDLE_HINT_ARMS}
            segments={IDLE_HINT_SEGMENTS}
            activation={IDLE_HINT_ACTIVATION}
            about={
              <>
                Half of players get the hint in their first-ever session: once the word box has sat empty for 7
                seconds, three Common words the puzzle would take are typed into it and erased. Each is drawn the
                first time they reach the play page, but counted here from the first time the clock runs out, which
                both arms report; most players type before it does. Every player here was new when drawn, so there
                is one table. Try either arm with <code>?idle-hint=treatment</code> or <code>=control</code>; a
                forced arm is not counted.
              </>
            }
          />
        </Section>
      )}

      {experiments.idleHintReturning && (
        <Section
          title="Idle hint, later sessions"
          note={`Whether typing a word into the empty box of a returning player sitting idle moves the scorecard. Over players who sat idle 12 seconds.${drawn}`}
        >
          <ExperimentView
            experiment={experiments.idleHintReturning}
            subject="the idle hint"
            arms={IDLE_HINT_ARMS}
            segments={IDLE_HINT_SEGMENTS}
            activation={IDLE_HINT_ACTIVATION}
            about={
              <>
                Half of players get the hint in any session after their first, drawn again on their own: a
                player&rsquo;s first-session arm says nothing about this one. The box has to sit empty for 12
                seconds. Each is counted from the first time that clock runs out, in either arm. Every player here
                was returning when drawn, so there is one table. Try either arm with{" "}
                <code>?idle-hint=treatment</code> or <code>=control</code>; a forced arm is not counted.
              </>
            }
          />
        </Section>
      )}
    </div>
  );
}

const IDLE_HINT_ARMS = { shown: "Hinted", hidden: "Not hinted" };

// Each idle hint experiment is one kind of session already, so the new and
// returning tables would only split it again by first word.
const IDLE_HINT_SEGMENTS = ["all"] as const;

const IDLE_HINT_ACTIVATION =
  "Activation is n/a here: a player sitting idle may not have banked a word yet, but the tables count only days " +
  "with one, so whether the hint gets a first word typed is on /analytics, in the idle hint section.";

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="av2__section">
      <h2 className="av2__heading">{title}</h2>
      <p className="review__meta av2__note">{note}</p>
      {children}
    </section>
  );
}


import { useCallback, useEffect, useRef, useState } from "react";
import { PuzzleNav } from "./PuzzleNav";
import { addDays, todayDateString } from "../game/date";
import { loadCorpus } from "../game/corpus";
import { formatRarityScore, rarityForZipf, usesFreeformRules } from "../game/dictionary";
import { foldedRows, type FoldedRow } from "../game/foldedRows";
import { foldRuleset, type FoldRule } from "../game/foldRules";
import { feedFloor, fetchFoundWords } from "../game/leaderboard";
import {
  fetchLiveFoldRejections,
  LiveFoldError,
  setLiveFoldRejection,
} from "../game/liveFoldRejections";
import { pageCache } from "../game/pageCache";
import { puzzleNumber } from "../game/share";
import { navigate } from "../routes";

type LoadState = "loading" | "ready" | "error";
/**
 * Whether the live rejections could be read. Apart from the rows on purpose:
 * the folds come from the finds feed and the corpus, and a puzzle's folds are
 * worth seeing even when the rejections behind them are not reachable.
 */
type LiveState = "ok" | "unavailable" | "not-migrated";

/** One puzzle's page as last read: its rows, its rejections, and whether those could be read. */
interface FoldedDay {
  rows: FoldedRow[];
  rejected: Map<string, string>;
  liveState: LiveState;
}

/**
 * Every puzzle read this visit, so stepping back to one -- or coming back to the
 * page -- shows it straight away while it is re-read (see game/pageCache.ts).
 * A rejection made here is written into it as it is made, so the remembered
 * page never shows a fold the reader has just taken back.
 */
const foldedCache = pageCache<FoldedDay>();

/**
 * The words folded on one puzzle, at /folded-live: step through the puzzles,
 * and reject a fold to have that word score as itself on that puzzle.
 *
 * Live, unlike /fold. A rejection here is written to the database and every
 * player who opens the puzzle has their word repriced and is told why (see
 * game/liveFoldRejections.ts and components/FoldedLiveNotice.tsx). Pressing it
 * again takes the rejection back. Scoped to the puzzle on screen and nothing
 * else: the reviewed, shipped route for a fold that is wrong everywhere is
 * still /fold.
 *
 * Unkeyed and unlinked, like /analytics: it opens without a password, and is
 * listed on /help.
 */
export function FoldedLivePage() {
  const today = useRef(todayDateString()).current;
  const floor = feedFloor();
  const [date, setDate] = useState(today);
  const [opening] = useState(() => foldedCache.get(today));
  const [rows, setRows] = useState<FoldedRow[]>(opening?.rows ?? []);
  /** Rejected words on this puzzle, word -> the base it had folded to. */
  const [rejected, setRejected] = useState<Map<string, string>>(
    opening?.rejected ?? new Map(),
  );
  const [state, setState] = useState<LoadState>(opening ? "ready" : "loading");
  const [liveState, setLiveState] = useState<LiveState>(opening?.liveState ?? "ok");
  const [saveFailed, setSaveFailed] = useState(false);
  const [reload, setReload] = useState(0);
  /** The row whose Reject is waiting on the warning, by word. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** The rule a row's link last pointed at, highlighted in the ruleset. */
  const [pointedRule, setPointedRule] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const freeformOnly = usesFreeformRules(date, "standard");
  const ruleset = foldRuleset(date);
  const ruleById = new Map(ruleset.map((rule) => [rule.id, rule]));

  useEffect(() => {
    if (!pointedRule) return;
    document
      .getElementById(`fold-rule-${pointedRule}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pointedRule]);

  /** Open the ruleset at the rule a fold used. */
  const showRule = (id: string) => {
    setRulesOpen(true);
    setPointedRule(null);
    // Set after the open lands, so the scroll finds the rule laid out.
    requestAnimationFrame(() => setPointedRule(id));
  };

  useEffect(() => {
    let cancelled = false;
    setSaveFailed(false);
    setConfirming(null);
    // A puzzle already read goes straight back up and the read below only
    // checks it; one not read yet starts empty, so no other puzzle's rows sit
    // under this one's heading while it loads.
    const cached = foldedCache.get(date);
    if (cached) {
      setRows(cached.rows);
      setRejected(cached.rejected);
      setLiveState(cached.liveState);
      setState("ready");
    } else {
      setState("loading");
      setRows([]);
      setRejected(new Map());
      setLiveState("ok");
    }
    if (freeformOnly) {
      setState("ready");
      return;
    }
    // The corpus first: since the corpus-era cutover the fold prices against
    // its lexicon, and tracing before it lands would report that nothing folds.
    Promise.all([
      loadCorpus(),
      fetchFoundWords(date, { fresh: true }),
      fetchLiveFoldRejections(date, { fresh: true }).catch((error: unknown) => error),
    ])
      .then(([, finds, read]) => {
        if (cancelled) return;
        const traced = foldedRows(date, finds);
        const rejections = Array.isArray(read) ? read : [];
        const liveRead: LiveState = Array.isArray(read)
          ? "ok"
          : read instanceof LiveFoldError && read.reason === "not-migrated"
            ? "not-migrated"
            : "unavailable";
        setLiveState(liveRead);
        // A rejected word the feed no longer carries still gets a row, so a
        // rejection can always be taken back from here.
        const shown = new Set(traced.map((row) => row.word));
        for (const r of rejections) {
          if (shown.has(r.word)) continue;
          traced.push({ word: r.word, base: r.base, ownZipf: NaN, baseZipf: NaN, finders: 0 });
        }
        const rejectedNow = new Map(rejections.map((r) => [r.word, r.base]));
        foldedCache.set(date, { rows: traced, rejected: rejectedNow, liveState: liveRead });
        setRows(traced);
        setRejected(rejectedNow);
        setState("ready");
      })
      .catch(() => {
        // A remembered puzzle stays up: a failed check is not news about rows
        // the reader can already see.
        if (!cancelled && !cached) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [date, freeformOnly, reload]);

  /**
   * Reject a fold, or take the rejection back. The row moves on the click and
   * the write follows; a failure puts it back and says so.
   */
  const toggle = useCallback(
    (row: FoldedRow) => {
      const was = rejected.has(row.word);
      const want = !was;
      const apply = (on: boolean) =>
        setRejected((all) => {
          const next = new Map(all);
          if (on) next.set(row.word, row.base);
          else next.delete(row.word);
          const kept = foldedCache.get(date);
          if (kept) foldedCache.set(date, { ...kept, rejected: next });
          return next;
        });
      setSaveFailed(false);
      setConfirming(null);
      apply(want);
      setLiveFoldRejection(date, { word: row.word, base: row.base }, want)
        .then((stored) => {
          if (live.current) apply(stored);
        })
        .catch(() => {
          if (!live.current) return;
          apply(was);
          setSaveFailed(true);
        });
    },
    [date, rejected]
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Words folded
            {state === "ready" && rows.length > 0 && (
              <span className="review__count">{rows.length}</span>
            )}
          </h1>
          <p className="page-head__note">
            Words players banked in Standard that scored as a common form. Reject a fold and
            that word scores as is on this puzzle — players who open it are told. Reject
            rarely: only a clear violation.
          </p>
        </div>
        <button
          type="button"
          className="app__icon-button leaderboard-page__refresh"
          onClick={() => setReload((n) => n + 1)}
          aria-label="Refresh"
          title="Refresh"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <PuzzleNav
        date={date}
        puzzleNumber={puzzleNumber(date)}
        canGoToPrevious={date > floor}
        canGoToNext={date < today}
        onPrevious={() => setDate((d) => (d > floor ? addDays(d, -1) : d))}
        onNext={() => setDate((d) => (d < today ? addDays(d, 1) : d))}
      />

      {ruleset.length > 0 && (
        <FoldRules
          rules={ruleset}
          open={rulesOpen}
          onToggle={setRulesOpen}
          pointed={pointedRule}
        />
      )}

      {state === "loading" && <p className="review__status">Loading…</p>}
      {state === "error" && (
        <p className="review__status">
          Couldn{"’"}t load this puzzle.{" "}
          <button
            type="button"
            className="review__retry"
            onClick={() => setReload((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      {state === "ready" && rows.length === 0 && (
        <p className="review__status">
          {freeformOnly
            ? "This puzzle was Freeform for everyone — nothing folded."
            : "No banked word on this puzzle was scored as a common form."}
        </p>
      )}
      {state === "ready" && liveState !== "ok" && (
        <p className="review__failed" role="status">
          {liveState === "not-migrated" ? (
            <>
              Rejecting isn{"’"}t set up yet: the database has no live_fold_rejections
              table. Apply the migrations (supabase db push) and refresh.
            </>
          ) : (
            <>
              Couldn{"’"}t load this puzzle{"’"}s rejections, so they can{"’"}t be
              changed right now.{" "}
              <button
                type="button"
                className="review__retry"
                onClick={() => setReload((n) => n + 1)}
              >
                Try again
              </button>
            </>
          )}
        </p>
      )}
      {saveFailed && (
        <p className="review__failed" role="status">
          Couldn{"’"}t save that — it{"’"}s been put back.
        </p>
      )}

      {state === "ready" && rows.length > 0 && (
        <ul className="review__list fold__list">
          {rows.map((row) => {
            const isRejected = rejected.has(row.word);
            const priced = Number.isFinite(row.ownZipf) && Number.isFinite(row.baseZipf);
            const rule = row.rule ? ruleById.get(row.rule) : undefined;
            const warning = confirming === row.word && !isRejected;
            return (
              <li
                key={row.word}
                className={`review__item fold__item folded-live__item${isRejected ? " folded-live__item--rejected" : ""}`}
              >
                <div className="review__body">
                  <p className="fold__fold">
                    <span className="fold__word">{row.word}</span>
                    <span className="fold__arrow" aria-hidden="true">
                      →
                    </span>
                    <span className={`fold__base${isRejected ? " folded-live__struck" : ""}`}>
                      {row.base}
                    </span>
                  </p>
                  {priced && (
                    <p className="fold__scores">
                      <span className="fold__score">
                        as is {formatRarityScore(row.ownZipf, date)}{" "}
                        {rarityForZipf(row.ownZipf, date, "standard")}
                      </span>
                      <span className="fold__score">
                        · folded {formatRarityScore(row.baseZipf, date)}{" "}
                        {rarityForZipf(row.baseZipf, date, "standard")}
                      </span>
                    </p>
                  )}
                  <p className="review__meta">
                    {row.finders > 0 && (
                      <span>
                        {row.finders} {row.finders === 1 ? "player" : "players"}
                      </span>
                    )}
                    {rule && (
                      <span>
                        Rule:{" "}
                        <button
                          type="button"
                          className="folded-live__rule-link"
                          onClick={() => showRule(rule.id)}
                        >
                          {rule.title}
                        </button>
                      </span>
                    )}
                    {isRejected && <span>Scoring as is</span>}
                  </p>
                </div>
                <button
                  type="button"
                  className={`folded-live__reject${isRejected ? " folded-live__reject--on" : ""}`}
                  aria-pressed={isRejected}
                  aria-expanded={isRejected ? undefined : warning}
                  disabled={liveState !== "ok"}
                  onClick={() => (isRejected ? toggle(row) : setConfirming(warning ? null : row.word))}
                >
                  {isRejected ? "Undo" : "Reject"}
                </button>
                {warning && (
                  <RejectWarning
                    rule={rule}
                    onShowRule={showRule}
                    onKeep={() => setConfirming(null)}
                    onReject={() => toggle(row)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className="leaderboard-page__back"
        onClick={() => navigate("game")}
      >
        Back to today{"’"}s puzzle
      </button>
    </main>
  );
}

/**
 * The fold's rules, shut by default: the page is a queue first. A row's "Rule:"
 * link opens it at the rule that row was folded by, so a reviewer judges the
 * fold against what the rule claims rather than against a hunch.
 */
function FoldRules({
  rules,
  open,
  onToggle,
  pointed,
}: {
  rules: FoldRule[];
  open: boolean;
  onToggle: (open: boolean) => void;
  pointed: string | null;
}) {
  return (
    <details
      className="folded-live__rules"
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
    >
      <summary className="folded-live__rules-summary">How folding works</summary>
      <p className="folded-live__rules-copy">
        In Standard a word scores as the most common form it folds to, so a rare
        spelling of a common word doesn{"’"}t score like a rare word. A fold is right
        when the word is just a form of its base: the same word inflected, negated, or
        made into another part of speech.
      </p>
      <div className="folded-live__guidance">
        <p className="folded-live__guidance-title">When to reject</p>
        <p className="folded-live__rules-copy">
          Rarely. Reject only a clear violation, where the two words are unrelated and
          the fold matched on spelling alone. If you have any doubt, don{"’"}t reject it.
        </p>
        <ul className="folded-live__cases">
          <li>
            <span className="folded-live__verdict folded-live__verdict--wrong">Wrong fold</span>{" "}
            <b>hearses</b> → <b>hears</b>: a hearse is not a form of hear. Reject.
          </li>
          <li>
            <span className="folded-live__verdict folded-live__verdict--right">Right fold</span>{" "}
            <b>uncompile</b> → <b>compile</b>: it{"’"}s just the negative of compile. Keep.
          </li>
        </ul>
      </div>
      <ul className="common-form__groups">
        {rules.map((rule) => (
          <li
            key={rule.id}
            id={`fold-rule-${rule.id}`}
            className={`common-form__group folded-live__rule${pointed === rule.id ? " folded-live__rule--pointed" : ""}`}
          >
            <p className="common-form__group-title">{rule.title}</p>
            {rule.affixes.length > 0 && (
              <p className="common-form__affixes">
                {rule.affixes.map((affix) => (
                  <span key={affix} className="common-form__affix">
                    {affix}
                  </span>
                ))}
              </p>
            )}
            {rule.note && <p className="common-form__example">{rule.note}</p>}
            {rule.example && (
              <p className="common-form__example">
                {rule.example.word} → {rule.example.base}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * What Reject asks before it writes. A rejection reprices every player holding
 * the word, live, so the warning names the rule the fold used and makes keeping
 * the fold the easy answer.
 */
function RejectWarning({
  rule,
  onShowRule,
  onKeep,
  onReject,
}: {
  rule: FoldRule | undefined;
  onShowRule: (id: string) => void;
  onKeep: () => void;
  onReject: () => void;
}) {
  return (
    <div className="folded-live__warning" role="alert">
      <p className="folded-live__warning-title">Only reject clearly unrelated words</p>
      <p className="folded-live__warning-copy">
        Rejecting a word changes live scores retroactively and can break players{"’"} trust.
        It should be done <b>very</b> rarely. Only reject words that are clearly unrelated,
        e.g. hearses → hears. Words that are the negative of each other should be folded
        per the rules (
        <button
          type="button"
          className="folded-live__rule-link"
          onClick={() => onShowRule("prefixes")}
        >
          see above
        </button>
        ).
      </p>
      {rule && (
        <p className="folded-live__warning-copy">
          This fold used{" "}
          <button
            type="button"
            className="folded-live__rule-link"
            onClick={() => onShowRule(rule.id)}
          >
            {rule.title}
          </button>
          . Check the word against that rule first before rejecting.
        </p>
      )}
      <div className="folded-live__warning-actions">
        <button type="button" className="folded-live__keep" onClick={onKeep}>
          Keep the fold
        </button>
        <button type="button" className="folded-live__reject" onClick={onReject}>
          Reject anyway
        </button>
      </div>
    </div>
  );
}

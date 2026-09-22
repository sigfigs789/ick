import { useCallback, useEffect, useState } from "react";
import { handleFor } from "../game/handle";
import { loadPlayerId } from "../game/player";
import {
  applyTransfer,
  collectTransfer,
  decodeTransfer,
  encodeTransfer,
  playerIdFrom,
  summarise,
  TRANSFER_VERSION,
  type TransferPayload,
} from "../game/transfer";
import { navigate, TRANSFER_PATH } from "../routes";

/**
 * Moving a player to another browser, as a page at /transfer.
 *
 * One page doing both halves, because which half it is is not a choice anybody
 * should have to make: a bare `/transfer` is the browser you are leaving and
 * offers a link; the same path carrying a payload in its hash is the browser
 * you are arriving at and offers to become somebody. The reader never picks a
 * mode, they just open the page they were sent to.
 *
 * Why a link rather than a code to type: the receiving device is, in the case
 * this was built for, a phone. A phone has no console to paste into and no
 * patience for a typed payload, but it opens links from messages all day. The
 * source device makes one, you send it to yourself, you tap it there.
 *
 * Why the hash rather than a query: a fragment never leaves the browser, so the
 * id -- which is a credential, since holding it means being that player -- does
 * not pass through the server, its logs, or a CDN cache key. See
 * game/transfer.ts, which says more about what that does and does not protect.
 *
 * The one thing this page will not do is act on arrival. It names the player
 * being adopted, names the one being left behind, and waits. An identity that
 * changed on tap would make this link a thing worth sending to somebody else.
 */
export function TransferPage() {
  return (
    <main>
      {readHash() ? <ReceiveTransfer /> : <SendTransfer />}
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

/** The hash as it stands, minus the `#`. Empty when there is none. */
function readHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash.replace(/^#/, "");
}

/**
 * The browser being left: build the link.
 *
 * Built on demand rather than on load. It is the player's own id in a string
 * long enough to be unmistakably *something*, and a page that renders it
 * unasked is a page that leaks it to whoever is looking at the screen. A button
 * makes producing it a thing the reader did.
 */
function SendTransfer() {
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "empty" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  const playerId = loadPlayerId();

  const build = useCallback(async () => {
    setState("working");
    const payload = collectTransfer();
    if (!payload) {
      setState("empty");
      return;
    }
    try {
      const encoded = await encodeTransfer(payload);
      setLink(`${window.location.origin}${TRANSFER_PATH}#${encoded}`);
      setState("idle");
    } catch {
      setState("failed");
    }
  }, []);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard permission, or an insecure origin. The link is on screen
      // and selectable, which is the fallback and needs no announcement.
      setCopied(false);
    }
  }, [link]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Move this player</h1>
          <p className="page-head__note">
            Send yourself a link that carries this browser{"’"}s whole record to
            another one.
          </p>
        </div>
      </div>

      {playerId ? (
        <p className="transfer__who">
          This browser plays as <strong>{handleFor(playerId)}</strong>.
        </p>
      ) : (
        <p className="review__status">
          This browser has no player yet — play a word first, then come back.
        </p>
      )}

      {playerId && !link && (
        <>
          <p className="transfer__warn">
            Anyone who opens the link becomes this player. Send it to yourself
            and to nobody else.
          </p>
          <button
            type="button"
            className="transfer__action"
            onClick={() => void build()}
            disabled={state === "working"}
          >
            {state === "working" ? "Building…" : "Build transfer link"}
          </button>
        </>
      )}

      {state === "empty" && (
        <p className="review__status">
          There{"’"}s nothing stored here to move.
        </p>
      )}
      {state === "failed" && (
        <p className="review__status">
          Couldn{"’"}t build the link on this browser.
        </p>
      )}

      {link && (
        <>
          <p className="transfer__note">
            Open this on the other browser. It won{"’"}t change anything until
            you confirm it there.
          </p>
          {/* Selectable text as well as a button: the clipboard needs a secure
              origin and a permission, and neither is guaranteed. */}
          <textarea
            className="transfer__link"
            aria-label="Transfer link"
            readOnly
            rows={4}
            value={link}
          />
          <button type="button" className="transfer__action" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </>
      )}

      <AdoptById />
    </>
  );
}

/**
 * The other direction, on the same page: become a player whose id you already
 * have.
 *
 * A link is for moving a record off a browser that still has one. This is for
 * the case where there is nothing to move -- a browser whose storage was
 * cleared, or one that is simply the only device there is -- and the identity
 * is known. It restores everything the identity owns, which is the board
 * record, and nothing it does not, which is the local history.
 *
 * Typed rather than pasted from a link because 36 characters is typeable and a
 * phone with no other device in the room has nothing to paste from.
 *
 * The confirmation step is not ceremony. A handle is a pure function of the id
 * (game/handle.ts), so showing the handle *before* applying turns the id into
 * something a human can proofread: a single mistyped character produces a
 * completely different name, and the reader knows the name they are expecting.
 * It is a checksum that happens to be readable.
 */
function AdoptById() {
  const [entered, setEntered] = useState("");
  const [candidate, setCandidate] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [failed, setFailed] = useState(false);

  const current = loadPlayerId();

  function check() {
    const id = playerIdFrom(entered);
    setCandidate(id);
    setBad(id === null);
  }

  function adopt() {
    if (!candidate) return;
    // No days: the identity is the whole of what an id can restore. See
    // `applyTransfer`, which leaves whatever this browser already has.
    if (!applyTransfer({ v: TRANSFER_VERSION, id: candidate, progress: {} })) {
      setFailed(true);
      return;
    }
    window.location.replace("/");
  }

  return (
    <section className="transfer__adopt">
      <h2 className="transfer__heading">Already know your player id?</h2>
      <p className="transfer__note">
        Make this browser that player. Its board record comes back; days played
        on a browser you no longer have do not.
      </p>

      <label className="transfer__label" htmlFor="transfer-id">
        Player id
      </label>
      <input
        id="transfer-id"
        className="transfer__input"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="00000000-0000-0000-0000-000000000000"
        value={entered}
        onChange={(event) => {
          setEntered(event.target.value);
          setCandidate(null);
          setBad(false);
        }}
      />

      {!candidate && (
        <button
          type="button"
          className="transfer__action"
          onClick={check}
          disabled={entered.trim() === ""}
        >
          Check this id
        </button>
      )}

      {bad && (
        <p className="review__status">
          That isn{"’"}t a player id. It{"’"}s 36 characters with four dashes.
        </p>
      )}

      {candidate && candidate === current && (
        <p className="review__status">
          This browser is already {handleFor(candidate)}.
        </p>
      )}

      {candidate && candidate !== current && (
        <>
          <p className="transfer__who">
            That id is <strong>{handleFor(candidate)}</strong>.{" "}
            {current ? (
              <>
                This browser plays as <strong>{handleFor(current)}</strong> and
                will stop.
              </>
            ) : (
              <>This browser has no player yet.</>
            )}
          </p>
          <p className="transfer__warn">
            If that name isn{"’"}t the one you expected, the id is wrong — check
            it rather than going on.
          </p>
          <button type="button" className="transfer__action" onClick={adopt}>
            Yes, become {handleFor(candidate)}
          </button>
        </>
      )}

      {failed && (
        <p className="review__status">
          Couldn{"’"}t save to this browser — storage is full or switched off,
          and nothing was changed.
        </p>
      )}
    </section>
  );
}

/**
 * The browser arriving: decode, describe, and wait to be told.
 *
 * The description is the whole point of the step. Two handles -- the one being
 * adopted and the one being replaced -- and the size of what is coming, so the
 * reader can tell at a glance whether this is the link they meant to open.
 */
function ReceiveTransfer() {
  const [payload, setPayload] = useState<TransferPayload | null>(null);
  const [state, setState] = useState<"reading" | "ready" | "bad" | "failed">("reading");

  const current = loadPlayerId();

  useEffect(() => {
    let live = true;
    void decodeTransfer(readHash()).then((decoded) => {
      if (!live) return;
      if (!decoded) {
        setState("bad");
        return;
      }
      setPayload(decoded);
      setState("ready");
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Take the identity, then reload.
   *
   * A reload rather than a re-render, and not for want of trying to be tidy:
   * `Root` reads the player id once during its first render and holds it in a
   * ref for the life of the page (see src/Root.tsx), which is right for every
   * other path -- an id does not change under a running app. This is the one
   * place it does, so the app is started again rather than asked to believe
   * something it was built to assume could not happen.
   *
   * Landing on `/` rather than back here: the hash has done its job, and
   * leaving it in the address bar leaves a live credential in the history of a
   * browser that may not be the reader's only one.
   */
  const confirm = useCallback(() => {
    if (!payload) return;
    if (!applyTransfer(payload)) {
      setState("failed");
      return;
    }
    window.location.replace("/");
  }, [payload]);

  if (state === "reading") return <p className="review__status">Reading the link…</p>;
  if (state === "bad") {
    return (
      <p className="review__status">
        This transfer link didn{"’"}t work. It may have been cut short on the way
        — try sending it again.
      </p>
    );
  }
  if (!payload) return null;

  const summary = summarise(payload);
  const incoming = handleFor(payload.id);
  const already = current === payload.id;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Become {incoming}?</h1>
          <p className="page-head__note">
            {summary.days > 0
              ? `${summary.days} ${summary.days === 1 ? "day" : "days"} of play, ${summary.first} to ${summary.last}.`
              : "No saved days — the identity only."}
          </p>
        </div>
      </div>

      {already ? (
        <p className="review__status">
          This browser is already {incoming}. There{"’"}s nothing to do.
        </p>
      ) : (
        <>
          <p className="transfer__who">
            This browser currently plays as{" "}
            <strong>{current ? handleFor(current) : "nobody yet"}</strong>. It
            will play as <strong>{incoming}</strong> from here on, and its scores
            will go to that player{"’"}s place on the board.
          </p>
          {current && (
            <p className="transfer__warn">
              {handleFor(current)} stays on the board with whatever it has
              already scored — this browser just stops being it.
            </p>
          )}
          <button type="button" className="transfer__action" onClick={confirm}>
            Yes, become {incoming}
          </button>
          <button
            type="button"
            className="transfer__cancel"
            onClick={() => navigate("game")}
          >
            No, leave this browser alone
          </button>
        </>
      )}

      {state === "failed" && (
        <p className="review__status">
          Couldn{"’"}t save to this browser — storage is full or switched off,
          and nothing was changed.
        </p>
      )}
    </>
  );
}

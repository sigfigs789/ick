import {
  ANALYTICS_PATH,
  FEEDBACK_PATH,
  FOLD_REVIEW_PATH,
  FOLDED_LIVE_PATH,
  FOUND_WORDS_PATH,
  FREEFORM_FEEDBACK_PATH,
  LEADERBOARD_PATH,
  LEADERBOARD_TOTAL_PATH,
  SUGGESTED_WORDS_PATH,
  TRANSFER_PATH,
} from "../routes";
import { keyQuery } from "../game/review";

interface PageLink {
  path: string;
  label: string;
  note: string;
  /** Carries the curator's `?key=` along, for the pages that read it. */
  keyed?: boolean;
}

const PLAYER_PAGES: PageLink[] = [
  { path: "/", label: "Play", note: "Today’s puzzle." },
  { path: LEADERBOARD_PATH, label: "Leaderboards", note: "Today, the week and all time." },
  { path: LEADERBOARD_TOTAL_PATH, label: "Puzzles played", note: "Every player, most puzzles first." },
  { path: FOUND_WORDS_PATH, label: "Words found", note: "The rarest words players have found." },
  { path: SUGGESTED_WORDS_PATH, label: "Suggested words", note: "The dictionary queue.", keyed: true },
  { path: TRANSFER_PATH, label: "Transfer", note: "Move this player to another browser." },
];

const CURATOR_PAGES: PageLink[] = [
  { path: ANALYTICS_PATH, label: "Analytics", note: "Who plays and whether they come back." },
  { path: FEEDBACK_PATH, label: "Feedback", note: "Notes players have left.", keyed: true },
  { path: FREEFORM_FEEDBACK_PATH, label: "Freeform feedback", note: "The Freeform week verdict.", keyed: true },
  { path: FOLD_REVIEW_PATH, label: "Fold review", note: "Approve or reject the scoring’s folds.", keyed: true },
  { path: FOLDED_LIVE_PATH, label: "Words folded", note: "Reject a puzzle’s folds live, one day at a time." },
];

const STATIC_PAGES: PageLink[] = [
  { path: "/privacy.html", label: "Privacy", note: "Privacy policy." },
  { path: "/terms.html", label: "Terms", note: "Terms of use." },
];

/**
 * Every page there is, at /help.
 *
 * Most of them are linked from nowhere (see src/routes.ts), which keeps them
 * out of a player's way and out of the maintainer's memory too. Plain links
 * rather than `navigate`, so a curator's `?key=` can ride along to the pages
 * that read it, and so each one opens in a new tab with a middle-click.
 */
export function HelpPage() {
  const key = keyQuery();

  function section(title: string, links: PageLink[]) {
    return (
      <section className="help__section">
        <h2 className="help__heading">{title}</h2>
        <ul className="help__list">
          {links.map((link) => (
            <li key={link.path} className="help__item">
              <a className="help__link" href={link.path + (link.keyed ? key : "")}>
                {link.label}
              </a>
              <code className="help__path">{link.path}</code>
              <span className="help__note">{link.note}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">All pages</h1>
          <p className="page-head__note">Everything on the site, linked or not.</p>
        </div>
      </div>
      {section("Game", PLAYER_PAGES)}
      {section("Maintainer", CURATOR_PAGES)}
      {section("Legal", STATIC_PAGES)}
    </main>
  );
}

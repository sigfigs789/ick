/**
 * The analytics page's words and number formats. Kept apart from the page so
 * the page file exports components only.
 */

export const MODE_NAMES: Record<string, string> = { standard: "Standard", freeform: "Freeform" };

/**
 * The report's `direct` is every visit with no source code, no utm_source and
 * no outside referrer -- mostly links opened from apps that send no referrer,
 * not typed URLs -- so it is shown for what it is. `untracked` is a player with
 * no web events at all: the iOS app or the Reddit post.
 */
export function sourceName(source: string): string {
  if (source === "direct") return "unattributed";
  if (source === "untracked") return "untracked (app, Reddit)";
  return source;
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

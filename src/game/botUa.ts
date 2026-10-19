/**
 * User agents that say outright they are not a person: headless Chrome, the
 * crawlers that name themselves, and audit tools. Shared by the client's visit
 * signals (src/analytics.ts) and the event endpoint's own read of the request
 * header (api/events.ts), so the two flag the same agents. Matched, never sent:
 * the raw string stays in the browser and the request.
 */
// "Cubot" is a phone maker whose Android user agents would otherwise read as
// "bot", the one real-device collision a plain match finds.
const BOT_UA_RE =
  /headlesschrome|(?<!cu)bot\b|crawler|spider|facebookexternalhit|lighthouse|phantomjs|puppeteer|playwright/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !!ua && BOT_UA_RE.test(ua);
}

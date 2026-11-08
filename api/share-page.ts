// The game's page, for a link that carries a shared result.
//
// GET /r?s=sh.f&d=YYYYMMDD&p=...   (rewritten here by vercel.json)
//   -> 200 the app's own index.html, with its preview tags pointed at this result
//
// A chat app unfurling the link reads og:image from the page it fetches. The
// built page names the generic WordInk card; this serves the same page with
// og:image swapped for api/share-image.ts drawing the result the link carries
// (see src/game/shareCard.ts), so the preview is the share block itself. A
// person following the link gets the same page and the game starts as it
// always does -- the game plays `/r` as it plays `/`.
//
// A link whose result cannot be read, or a page that cannot be fetched, falls
// back to the plain page, with the result left off the address.

import { SHARE_CARD_PATH, cardHeading, decodeShareCard } from "../src/game/shareCard";

export const config = { runtime: "edge" };

const GENERIC_IMAGE = "https://www.wordink.app/og-image.png?v=3";

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setMeta(html: string, attr: "property" | "name", key: string, value: string): string {
  const tag = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`);
  return html.replace(tag, `$1${escapeAttr(value)}$2`);
}

/** The plain page: the same address with the result taken off it. */
function plainPage(url: URL): Response {
  const plain = new URL("/", url);
  const source = url.searchParams.get("s");
  if (source) plain.searchParams.set("s", source);
  return Response.redirect(plain.toString(), 302);
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const card = decodeShareCard(url.searchParams);
  if (!card) return plainPage(url);

  const page = await fetch(new URL("/index.html", url)).catch(() => null);
  if (!page?.ok) return plainPage(url);
  let html = await page.text();

  const image = new URL("/api/share-image", url);
  image.search = url.search;
  image.searchParams.delete("s");
  const imageUrl = image.toString();
  const title = `${cardHeading(card)} — ${card.totalLabel}: ${card.total}`;

  html = html.split(GENERIC_IMAGE).join(escapeAttr(imageUrl));
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "name", "twitter:title", title);
  // The address the reader shared, not the function it was rewritten to.
  const shared = new URL(SHARE_CARD_PATH, url);
  shared.search = url.search;
  html = setMeta(html, "property", "og:url", shared.toString());

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The page is the deploy's index.html, which is never cached either.
      "cache-control": "no-store, max-age=0",
    },
  });
}

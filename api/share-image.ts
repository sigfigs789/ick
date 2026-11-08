// The preview image for a shared result: a picture of the share block.
//
// GET /api/share-image?d=YYYYMMDD&p=drop&w=...&t=...   (see src/game/shareCard.ts)
//   -> 200 image/png, 1200x630
//   -> 302 /og-image.png when the link carries no readable result
//
// A chat app reads this through the og:image that api/share-page.ts writes for
// a result link. The picture is a pure function of the query, so it is cached
// for as long as a CDN will keep it.
//
// Anyone can hand-make a link, and the picture goes out under the WordInk name,
// so the free text on it -- the player name and any named words -- goes through
// the chat room's profanity check first and is left off when it fails.

import { ImageResponse } from "@vercel/og";
import type { ReactElement } from "react";
import { chatProblem } from "../src/game/chat";
import {
  cardHeading,
  decodeShareCard,
  type CardRarity,
  type ShareCard,
} from "../src/game/shareCard";

export const config = { runtime: "edge" };

const WIDTH = 1200;
const HEIGHT = 630;

const INK = "#1a1a1b";
const MUTED = "#5d6066";
const BG = "#fafafa";
const RED = "#e5484d";

/** The share squares' colours, after the emoji the text uses (see game/share.ts). */
const SQUARE: Record<CardRarity, { fill: string; border?: string }> = {
  Quotidian: { fill: "#f5ecd7", border: "#d8c9a6" },
  Common: { fill: "#eceef1", border: "#c9ccd1" },
  Uncommon: { fill: "#2fa457" },
  Rare: { fill: "#2f78e0" },
  "Extremely Rare": { fill: "#9b4fe0" },
  Elusive: { fill: "#eab308" },
  Mythic: { fill: "#e5484d" },
  Legend: { fill: "#1b1b1f" },
  "legacy-legend": { fill: "#ff8000" },
};

type Style = Record<string, string | number>;
type Child = Node | string | null | false;
interface Node {
  type: string;
  props: { style?: Style; children?: Child | Child[] };
}

/** A satori element without JSX: this file is plain TypeScript. */
function h(type: string, style: Style, ...children: Child[]): Node {
  const kept = children.filter((child) => child !== null && child !== false);
  return {
    type,
    // Satori lays out flexbox only, and wants it said on every <div>.
    props: {
      style: type === "div" ? { display: "flex", ...style } : style,
      children: kept.length === 1 ? kept[0] : kept,
    },
  };
}

function clean(text: string | undefined): string | undefined {
  return text && chatProblem(text) === null ? text : undefined;
}

/** The fonts the app uses. Fetched once per instance; a failure falls back to the default font. */
let fontsPromise: Promise<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]> | null =
  null;

async function googleFont(family: string, weight: number): Promise<ArrayBuffer> {
  // Without a modern browser's user agent the stylesheet points at TTF files,
  // which is what satori reads.
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`)
  ).text();
  const url = /src: url\((.+?)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
  if (!url) throw new Error(`no font file for ${family} ${weight}`);
  return (await fetch(url)).arrayBuffer();
}

function loadFonts() {
  fontsPromise ??= Promise.all([
    googleFont("Libre+Franklin", 800),
    googleFont("Karla", 500),
    googleFont("Karla", 700),
  ])
    .then(([franklin, karla, karlaBold]) => [
      { name: "Libre Franklin", data: franklin, weight: 800 as const, style: "normal" as const },
      { name: "Karla", data: karla, weight: 500 as const, style: "normal" as const },
      { name: "Karla", data: karlaBold, weight: 700 as const, style: "normal" as const },
    ])
    .catch(() => {
      fontsPromise = null;
      return undefined;
    });
  return fontsPromise;
}

function square(rarity: CardRarity, size: number): Node {
  const { fill, border } = SQUARE[rarity];
  return h("div", {
    width: size,
    height: size,
    borderRadius: size * 0.18,
    background: fill,
    border: border ? `3px solid ${border}` : "none",
    flexShrink: 0,
  });
}

export function renderCard(card: ShareCard): Node {
  const words = card.words.map((w) => (w.word ? { ...w, word: clean(w.word) } : w));
  const name = clean(card.playerName);
  // Up to five rows in one column; more go into two, and shrink to fit.
  const columns = words.length > 5 ? 2 : 1;
  const rows = Math.ceil(words.length / columns);
  const rowSize = rows <= 3 ? 64 : rows <= 4 ? 54 : rows <= 5 ? 46 : 36;

  const wordRows = words.map((w) =>
    h(
      "div",
      {
        display: "flex",
        alignItems: "center",
        gap: rowSize * 0.4,
        height: rowSize * 1.3,
      },
      square(w.rarity, rowSize),
      h(
        "div",
        { display: "flex", fontFamily: "Karla", fontWeight: 700, fontSize: rowSize * 0.8, color: INK },
        w.score,
      ),
      w.word
        ? h(
            "div",
            { display: "flex", fontFamily: "Karla", fontWeight: 500, fontSize: rowSize * 0.8, color: MUTED },
            w.word,
          )
        : null,
    ),
  );

  const scoreText = `${card.totalLabel}: ${card.total}`;
  const stats =
    card.streak !== undefined
      ? `Streak: ${card.streak} day${card.streak === 1 ? "" : "s"} · ${scoreText}`
      : scoreText;

  return h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      display: "flex",
      flexDirection: "column",
      background: BG,
      padding: "56px 72px",
      fontFamily: "Karla",
      color: INK,
    },
    h(
      "div",
      { display: "flex", fontFamily: "Libre Franklin", fontWeight: 800, fontSize: 52 },
      cardHeading(card),
    ),
    h(
      "div",
      { marginTop: 28, flexGrow: 1, alignItems: "flex-start" },
      // Down the first column, then the second, the order the text lists them in.
      ...Array.from({ length: columns }, (_, column) =>
        h(
          "div",
          { flexDirection: "column", width: `${100 / columns}%` },
          ...wordRows.slice(column * rows, (column + 1) * rows),
        ),
      ),
    ),
    h(
      "div",
      { display: "flex", alignItems: "flex-end", justifyContent: "space-between" },
      h(
        "div",
        { display: "flex", flexDirection: "column", gap: 6 },
        h("div", { display: "flex", fontSize: 40, fontWeight: 700 }, stats),
        name ? h("div", { display: "flex", fontSize: 30, fontWeight: 500, color: MUTED }, `Playing as ${name}`) : null,
      ),
      h(
        "div",
        { display: "flex", fontFamily: "Libre Franklin", fontWeight: 800, fontSize: 52 },
        h("span", { color: INK }, "Word"),
        h("span", { color: RED }, "Ink"),
      ),
    ),
  );
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const card = decodeShareCard(url.searchParams);
  if (!card) {
    return Response.redirect(new URL("/og-image.png?v=3", url).toString(), 302);
  }
  const fonts = await loadFonts();
  return new ImageResponse(renderCard(card) as unknown as ReactElement, {
    width: WIDTH,
    height: HEIGHT,
    ...(fonts ? { fonts } : {}),
    headers: {
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}

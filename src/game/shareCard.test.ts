import { describe, expect, it } from "vitest";
import {
  CARD_MAX_WORDS,
  cardHeading,
  decodeShareCard,
  encodeShareCard,
  type ShareCard,
} from "./shareCard";

const card: ShareCard = {
  date: "2026-11-08",
  drop: "ink",
  mode: "Freeform",
  words: [
    { rarity: "Rare", score: "7.2" },
    { rarity: "legacy-legend", score: "10.00", word: "wrinkle" },
  ],
  total: "17.2",
  totalLabel: "Today",
  streak: 3,
  playerName: "u/mo",
};

const params = (query: string) => new URLSearchParams(query);

describe("share card", () => {
  it("survives a trip through the link", () => {
    expect(decodeShareCard(new URLSearchParams(encodeShareCard(card)))).toEqual(card);
  });

  it("writes a compact query", () => {
    expect(new URLSearchParams(encodeShareCard(card)).toString()).toBe(
      "d=20261108&p=ink&m=f&w=r7.2_o10.00wrinkle&y=17.2&k=3&n=u%2Fmo",
    );
  });

  it("reads no card from a link without one", () => {
    expect(decodeShareCard(params("s=sh.f"))).toBeNull();
  });

  it("rejects a malformed field rather than drawing it", () => {
    expect(decodeShareCard(params("d=2026118&p=ink&t=1.0"))).toBeNull();
    expect(decodeShareCard(params("d=20261108&p=in k&t=1.0"))).toBeNull();
    expect(decodeShareCard(params("d=20261108&p=ink&t=lots"))).toBeNull();
    expect(decodeShareCard(params("d=20261108&p=ink&w=z7.2&t=7.2"))).toBeNull();
    expect(decodeShareCard(params("d=20261108&p=ink&w=r7.2<b>&t=7.2"))).toBeNull();
  });

  it("caps what a hand-made link can put on the picture", () => {
    const many = Array.from({ length: 40 }, () => "c1.0").join("_");
    const decoded = decodeShareCard(
      params(`d=20261108&p=ink&w=${many}&t=40.0&n=${"x".repeat(200)}`),
    )!;
    expect(decoded.words).toHaveLength(CARD_MAX_WORDS);
    expect(decoded.playerName!.length).toBeLessThanOrEqual(40);
  });

  it("heads the card the way the share text is headed", () => {
    expect(cardHeading(card)).toBe("Nov 8 — Drop: INK · Freeform");
    expect(cardHeading({ ...card, mode: undefined })).toBe("Nov 8 — Drop: INK");
  });
});

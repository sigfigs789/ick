import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./share-page";

const INDEX = `<!doctype html><html><head>
    <meta property="og:title" content="WordInk — find the rarest word each day" />
    <meta property="og:url" content="https://www.wordink.app/" />
    <meta property="og:image" content="https://www.wordink.app/og-image.png?v=3" />
    <meta name="twitter:title" content="WordInk — find the rarest word each day" />
    <meta name="twitter:image" content="https://www.wordink.app/og-image.png?v=3" />
</head><body><div id="root"></div></body></html>`;

const QUERY = "s=sh.f&d=20261108&p=ink&m=f&w=r7.2_l10.00wrinkle&y=17.2&k=3&n=u%2Fmo";

describe("share page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serves the app's page with its preview pointed at the result", async () => {
    const fetchMock = vi.fn<(url: URL) => Promise<Response>>(async () => new Response(INDEX));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handler(new Request(`https://www.wordink.app/api/share-page?${QUERY}`));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://www.wordink.app/index.html");
    expect(html).not.toContain("og-image.png");
    expect(html).toContain(
      'property="og:image" content="https://www.wordink.app/api/share-image?d=20261108&amp;p=ink',
    );
    expect(html).toContain('name="twitter:image" content="https://www.wordink.app/api/share-image?');
    expect(html).toContain(
      'property="og:title" content="Nov 8 — Drop: INK · Freeform — Today: 17.2"',
    );
    expect(html).toContain(`property="og:url" content="https://www.wordink.app/r?${QUERY.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('<div id="root">');
  });

  it("sends a link with no readable result to the plain page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await handler(new Request("https://www.wordink.app/api/share-page?s=sh.f&d=bad"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.wordink.app/?s=sh.f");
  });

  it("falls back to the plain page when the page cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const res = await handler(new Request(`https://www.wordink.app/api/share-page?${QUERY}`));
    expect(res.status).toBe(302);
  });
});

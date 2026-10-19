import { describe, expect, it } from "vitest";
import { isBotUserAgent } from "./botUa";

describe("isBotUserAgent", () => {
  it("flags agents that name themselves", () => {
    for (const ua of [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
  });

  it("passes real browsers, a Cubot phone among them", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 13; CUBOT X70 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
    expect(isBotUserAgent(null)).toBe(false);
    expect(isBotUserAgent("")).toBe(false);
  });
});

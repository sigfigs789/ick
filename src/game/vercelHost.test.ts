import { describe, expect, it } from "vitest";
import { isVercelHost, isVercelRequest } from "./vercelHost";

describe("isVercelHost", () => {
  it("matches Vercel's own domain and its subdomains", () => {
    expect(isVercelHost("ick-git-branch-sigfigs789.vercel.app")).toBe(true);
    expect(isVercelHost("ICK.VERCEL.APP")).toBe(true);
    expect(isVercelHost("vercel.app")).toBe(true);
  });

  it("leaves the real site and look-alikes alone", () => {
    expect(isVercelHost("www.wordink.app")).toBe(false);
    expect(isVercelHost("wordink.app")).toBe(false);
    expect(isVercelHost("notvercel.app")).toBe(false);
    expect(isVercelHost("vercel.app.example.com")).toBe(false);
    expect(isVercelHost("localhost")).toBe(false);
    expect(isVercelHost("")).toBe(false);
    expect(isVercelHost(null)).toBe(false);
  });

  it("reads a request's own host", () => {
    expect(isVercelRequest(new Request("https://ick-abc.vercel.app/api/events"))).toBe(true);
    expect(isVercelRequest(new Request("https://www.wordink.app/api/events"))).toBe(false);
  });
});

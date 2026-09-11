import { beforeEach, describe, expect, it } from "vitest";
import { navigate, pathFor, routeFor } from "./routes";

beforeEach(() => {
  window.history.pushState(null, "", "/");
});

describe("routes", () => {
  it("recognises the leaderboard path", () => {
    expect(routeFor("/leaderboard")).toBe("leaderboard");
    // A shared link may well carry a trailing slash.
    expect(routeFor("/leaderboard/")).toBe("leaderboard");
  });

  it("recognises the found words path", () => {
    expect(routeFor("/found-words")).toBe("found-words");
    expect(routeFor("/found-words/")).toBe("found-words");
  });

  it("treats anything else as the game, rather than a client-rendered 404", () => {
    expect(routeFor("/")).toBe("game");
    expect(routeFor("")).toBe("game");
    expect(routeFor("/whatever")).toBe("game");
    expect(routeFor("/leaderboards")).toBe("game");
  });

  it("maps each route back to its path", () => {
    expect(pathFor("leaderboard")).toBe("/leaderboard");
    expect(pathFor("found-words")).toBe("/found-words");
    expect(pathFor("game")).toBe("/");
  });

  it("pushes a history entry, so Back returns where the player was", () => {
    navigate("leaderboard");
    expect(window.location.pathname).toBe("/leaderboard");
    window.history.back();
    // jsdom applies popstate asynchronously, so this only asserts the entry
    // exists to go back to; the page's own reaction is covered by useRoute.
    expect(window.history.length).toBeGreaterThan(1);
  });

  it("does nothing when already on the route", () => {
    navigate("leaderboard");
    const before = window.history.length;
    navigate("leaderboard");
    expect(window.history.length).toBe(before);
  });

  it("notifies listeners on a push, the same way the back button does", () => {
    let heard = 0;
    const listener = () => (heard += 1);
    window.addEventListener("popstate", listener);
    navigate("leaderboard");
    window.removeEventListener("popstate", listener);
    expect(heard).toBe(1);
  });
});

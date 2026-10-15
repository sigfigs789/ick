import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { navigate, pathFor, routeFor, setInMemoryRouting, useRoute } from "./routes";

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

  it("recognises the two review paths, which nothing links to", () => {
    expect(routeFor("/suggested-words")).toBe("suggested-words");
    expect(routeFor("/suggested-words/")).toBe("suggested-words");
    expect(routeFor("/feedback")).toBe("feedback");
    expect(routeFor("/feedback/")).toBe("feedback");
    expect(routeFor("/freeform-feedback")).toBe("freeform-feedback");
    expect(routeFor("/freeform-feedback/")).toBe("freeform-feedback");
    expect(routeFor("/fold")).toBe("fold-review");
    expect(routeFor("/fold/")).toBe("fold-review");
    expect(routeFor("/folded-live")).toBe("folded-live");
    expect(routeFor("/analytics")).toBe("analytics");
    expect(routeFor("/analytics/")).toBe("analytics");
    expect(pathFor("analytics")).toBe("/analytics");
    expect(routeFor("/help")).toBe("help");
    expect(routeFor("/help/")).toBe("help");
    expect(pathFor("help")).toBe("/help");
    expect(routeFor("/leaderboard-total")).toBe("leaderboard-total");
    expect(routeFor("/leaderboard-total/")).toBe("leaderboard-total");
    expect(pathFor("leaderboard-total")).toBe("/leaderboard-total");
    expect(routeFor("/dead-streaks")).toBe("dead-streaks");
    expect(routeFor("/dead-streaks/")).toBe("dead-streaks");
    expect(pathFor("dead-streaks")).toBe("/dead-streaks");
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
    expect(pathFor("suggested-words")).toBe("/suggested-words");
    expect(pathFor("feedback")).toBe("/feedback");
    expect(pathFor("freeform-feedback")).toBe("/freeform-feedback");
    expect(pathFor("fold-review")).toBe("/fold");
    expect(pathFor("folded-live")).toBe("/folded-live");
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

describe("routing in memory, for a host with no address bar", () => {
  afterEach(() => {
    // Back to the address bar, or every test after this one routes in memory.
    setInMemoryRouting(false);
  });

  it("is off by default, which is what this site relies on", () => {
    window.history.pushState(null, "", "/leaderboard");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe("leaderboard");
  });

  it("starts on the game, whatever the address bar happens to say", () => {
    window.history.pushState(null, "", "/leaderboard");
    setInMemoryRouting(true);
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe("game");
  });

  it("moves between pages without touching the address bar", () => {
    window.history.pushState(null, "", "/");
    setInMemoryRouting(true);
    const { result } = renderHook(() => useRoute());

    act(() => navigate("leaderboard"));
    expect(result.current).toBe("leaderboard");
    // The URL is the one thing that must not move: a reload would ask the
    // static server for a path it has no rewrite for and no file behind.
    expect(window.location.pathname).toBe("/");

    act(() => navigate("found-words"));
    expect(result.current).toBe("found-words");
    expect(window.location.pathname).toBe("/");
  });

  it("comes back to the game", () => {
    setInMemoryRouting(true);
    const { result } = renderHook(() => useRoute());
    act(() => navigate("leaderboard"));
    act(() => navigate("game"));
    expect(result.current).toBe("game");
  });

  it("hands routing back to the address bar when switched off", () => {
    setInMemoryRouting(true);
    act(() => navigate("leaderboard"));
    setInMemoryRouting(false);

    window.history.pushState(null, "", "/found-words");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe("found-words");
  });
});

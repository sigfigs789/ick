/**
 * The Reddit build reports nothing, and that is what keeps a Reddit username out
 * of the analytics sinks.
 *
 * Worth a test of its own because the guarantee is split across two files and
 * neither says so. `src/analytics.ts` is free to send the board identity along
 * with an event -- it is a UUID the browser invented, with a name computed from
 * it, so there is nobody behind it to identify. Inside a Reddit post that
 * identity is something else entirely: `setAccount` replaces it with the
 * player's actual username (see src/game/player.ts, loadPlayerId), which is a
 * real person's login and must never be reported anywhere.
 *
 * Nothing in the analytics code notices the difference. What makes the username
 * unreportable is that the only build which sets one also turns reporting off,
 * in the same file, unconditionally. That is a fact about devvit's entry module
 * rather than about analytics, so it is pinned here: move or condition the
 * `setReporting(false)` call and this fails, instead of the username quietly
 * beginning to ride along on every event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setReporting = vi.hoisted(() => vi.fn());
const setAccount = vi.hoisted(() => vi.fn());
const setInMemoryRouting = vi.hoisted(() => vi.fn());
const render = vi.hoisted(() => vi.fn());

vi.mock("../../src/analytics", () => ({ setReporting }));
vi.mock("../../src/game/player", () => ({ setAccount }));
vi.mock("../../src/routes", () => ({ setInMemoryRouting }));
vi.mock("../../src/Root", () => ({ Root: () => null }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
vi.mock("../../src/index.css", () => ({}));

/** Load the entry module fresh, with /api/init answering as given. */
async function boot(init: () => Promise<Response>): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(init));
  vi.resetModules();
  await import("../src/client/game");
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  setReporting.mockClear();
  setAccount.mockClear();
});

describe("the Reddit build's reporting switch", () => {
  it("turns reporting off for a player signed in as a Reddit account", async () => {
    await boot(async () => Response.json({ username: "some_redditor" }));

    // The username is now this player's board identity, so every event that
    // carries one would carry it. The switch is what makes that moot.
    expect(setAccount).toHaveBeenCalledWith("some_redditor");
    expect(setReporting).toHaveBeenCalledWith(false);
    expect(setReporting).toHaveBeenCalledTimes(1);
  });

  it("turns reporting off even when no account came back", async () => {
    await boot(async () => Response.json({}));

    // Unconditional rather than tied to the account: a build that only stopped
    // reporting once it knew it had a username would be one refetch away from
    // reporting everything, and Reddit's players are not to be reported on
    // whether or not they are signed in.
    expect(setAccount).not.toHaveBeenCalled();
    expect(setReporting).toHaveBeenCalledWith(false);
  });

  it("turns reporting off when /api/init fails outright", async () => {
    await boot(async () => {
      throw new Error("no server");
    });

    // The failure path leaves the browser's own identity in place and plays on.
    // It must not also leave reporting on.
    expect(setAccount).not.toHaveBeenCalled();
    expect(setReporting).toHaveBeenCalledWith(false);
  });
});

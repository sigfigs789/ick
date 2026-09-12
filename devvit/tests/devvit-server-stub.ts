/**
 * Stands in for `@devvit/web/server` when the repo's test runner resolves it.
 *
 * The Devvit project keeps its own `node_modules`, and the repo's CI installs
 * only the root's -- so under `npm test` from a clean checkout that import
 * cannot be resolved and every test touching the Devvit server fails to load.
 * Installing the second tree in CI would mean raising the whole repo's Node
 * version to satisfy Devvit's floor, which is a large change to make for three
 * test files.
 *
 * None of them need the real module. Each mocks it outright, because the real
 * one only works inside a running post. What they need is for the specifier to
 * resolve, which is all this provides.
 *
 * It is deliberately hostile about being used. Every property throws rather
 * than returning a convenient empty object, so a test that forgets to mock
 * fails saying exactly that, instead of passing against a silent stub and
 * proving nothing.
 */

function unavailable(what: string): never {
  throw new Error(
    `@devvit/web/server is stubbed under the repo's test runner and ${what} was used for real. ` +
      `Mock the module with vi.mock("@devvit/web/server", ...) in this test.`
  );
}

function hostile(name: string): never {
  return new Proxy(
    {},
    {
      get: (_target, property) => unavailable(`${name}.${String(property)}`),
    }
  ) as never;
}

export const redis = hostile('redis');
export const reddit = hostile('reddit');
export const settings = hostile('settings');
export const context = hostile('context');
export const scheduler = hostile('scheduler');
export const media = hostile('media');

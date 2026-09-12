/**
 * Rewrite `import.meta.env` for a bundler that has no `import.meta`.
 *
 * The game's modules are shared with the website, which Vite builds, and three
 * of them ask Vite for the build mode:
 *
 *   - `src/game/leaderboard.ts` guards its sample-data path on `DEV`.
 *   - `src/analytics.ts` skips the Supabase mirror when `MODE === "test"`.
 *
 * Metro emits CommonJS, where `import.meta` is not merely undefined but a
 * syntax error -- the bundle fails to build, well before any of those branches
 * could be evaluated. So the expression is replaced at compile time with an
 * object literal carrying the two fields the shared code reads.
 *
 * `DEV` follows Metro's own `__DEV__`, so a development bundle gets the
 * development branch and a release bundle does not -- the same split Vite
 * draws, expressed in the flag this bundler actually has. `MODE` is the string
 * Vite would produce for the same build; it is never `"test"` here, because
 * these modules are tested by Vitest against the web build and not by running
 * this bundle.
 *
 * Narrow on purpose: it matches `import.meta.env` and nothing else. A bare
 * `import.meta` or an `import.meta.url` is left alone to fail loudly, because
 * either would mean shared code had grown a dependency on the bundler that this
 * build genuinely cannot answer, and a quiet `undefined` would hide it.
 */
module.exports = function importMetaEnv({ types: t }) {
  const env = () =>
    t.objectExpression([
      t.objectProperty(t.identifier('DEV'), t.identifier('__DEV__')),
      t.objectProperty(
        t.identifier('MODE'),
        t.conditionalExpression(
          t.identifier('__DEV__'),
          t.stringLiteral('development'),
          t.stringLiteral('production'),
        ),
      ),
    ]);

  return {
    name: 'import-meta-env',
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        if (node.computed) return;
        if (!t.isIdentifier(node.property, { name: 'env' })) return;
        if (!t.isMetaProperty(node.object)) return;
        if (node.object.meta.name !== 'import' || node.object.property.name !== 'meta') return;
        path.replaceWith(env());
      },
    },
  };
};

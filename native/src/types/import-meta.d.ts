/**
 * `import.meta.env`, for the type checker.
 *
 * The shared modules this app reuses are written for Vite, which declares this
 * shape through `vite/client` (see `src/vite-env.d.ts` at the repo root). That
 * declaration is not in this project's compilation, so without this the three
 * files that read the build mode fail to typecheck here while compiling
 * perfectly well for the website.
 *
 * Only the two fields the shared code actually reads, and both are the exact
 * types Vite gives them -- a wider declaration would let a new use of
 * `import.meta` typecheck here that the Babel plugin does not rewrite, and it
 * would fail at bundle time instead. See tools/babel-plugin-import-meta-env.cjs
 * for what happens to these expressions on the way into the bundle.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** A lazily loaded component, with a way to start fetching it early. */
export type LazyPage<P = object> = LazyExoticComponent<ComponentType<P>> & {
  /** Fetch the chunk now, without rendering it. Failures are left for render. */
  preload: () => void;
};

/**
 * A component that is its own chunk, fetched the first time it renders.
 *
 * `load` resolves the module and `pick` takes the component out of it -- the
 * pages are named exports, and `lazy` wants a default.
 *
 * A failed fetch is chunkRecovery's to handle: it reloads the tab, and the
 * import then resolves to `undefined` rather than throwing. That case is held
 * on the Suspense fallback until the reload lands, rather than rendered as an
 * error a moment before the page goes away anyway.
 *
 * `preload` starts the same fetch the first render would, and the two share it,
 * so warming a page up ahead of a tap cannot drift from the import the page
 * actually uses.
 */
export function lazyPage<M, P extends object = object>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
): LazyPage<P> {
  let pending: Promise<M> | undefined;
  const fetchModule = () =>
    (pending ??= load().catch((error: unknown) => {
      // Forgotten, so the next attempt asks the network again.
      pending = undefined;
      throw error;
    }));
  const Page = lazy(async () => {
    const module = await fetchModule();
    if (module === undefined) return new Promise<never>(() => {});
    return { default: pick(module) };
  });
  return Object.assign(Page, {
    preload: () => {
      void fetchModule().catch(() => {});
    },
  });
}

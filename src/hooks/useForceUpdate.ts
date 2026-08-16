import { useEffect } from 'react'
import { APP_VERSION } from '../version'

// Silently forces a stale tab onto the latest deploy when — and only when —
// the running version is below the required-version floor (minVersion) that we
// control by hand in src/version.ts.
//
// It never reloads for ordinary deploys: a deploy only bumps APP_VERSION, so
// tabs stay put. Bumping MIN_VERSION (published via version.json) is what makes
// a release mandatory and triggers the reload below.
//
// Reloading is safe: all game state lives in localStorage (ick:*), which
// survives a reload untouched. No banner, no prompt — the user gets no choice.
//
// We don't poll on an interval; we check at the moments a stale tab actually
// resurfaces: initial mount, tab foregrounding, and bfcache restore.
async function checkRequiredVersion() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return
    const { minVersion } = (await res.json()) as { minVersion?: number }
    if (typeof minVersion === 'number' && APP_VERSION < minVersion) {
      window.location.reload()
    }
  } catch {
    // Offline or transient failure — leave the tab alone and try again on the
    // next foreground/pageshow.
  }
}

export function useForceUpdate() {
  useEffect(() => {
    void checkRequiredVersion()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkRequiredVersion()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      // Restored from the back/forward cache — the tab reappeared without a
      // real load, so re-check.
      if (e.persisted) void checkRequiredVersion()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])
}

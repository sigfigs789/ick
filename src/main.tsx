import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
import { installChunkRecovery } from './chunkRecovery'
import { assignStartingMode } from './game/onboarding'
import { adoptPlayerFromUrl } from './game/player'
import { visitorTag } from './game/visitor'

// First, so a chunk that fails at any point in the visit -- including one
// asked for during the first render -- reloads the tab (see chunkRecovery.ts).
installChunkRecovery()

// Muse AI's `?player=` id, stored before Root's `joinBoard` would mint a new
// one (see game/player.ts). Taken out of the address bar once read, so it is
// not carried into anything shared.
adoptPlayerFromUrl(window.location.search)
{
  const url = new URL(window.location.href)
  if (url.searchParams.has('player')) {
    url.searchParams.delete('player')
    window.history.replaceState(window.history.state, '', url)
  }
}

// Before the first render: a brand-new player's starting mode decides which
// progress and scoring the puzzle loads with (see game/onboarding.ts).
assignStartingMode(window.location.search)

// Muse AI's `?visitor=` tag, kept before anything can navigate the query away
// (see game/visitor.ts).
visitorTag(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

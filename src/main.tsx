import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
import { setReporting } from './analytics'
import { installChunkRecovery } from './chunkRecovery'
import { assignStartingMode } from './game/onboarding'
import { adoptPlayerFromUrl } from './game/player'
import { excludeShareNameIfChosen } from './game/shareName'
import { setPlayerMessages } from './game/playerMessages'
import { visitorTag } from './game/visitor'
import { isVercelHost } from './game/vercelHost'

// First, so a chunk that fails at any point in the visit -- including one
// asked for during the first render -- reloads the tab (see chunkRecovery.ts).
installChunkRecovery()

// A preview or *.vercel.app alias is the people building the game: no events
// from it (see game/vercelHost.ts). The endpoints
// drop its events and scores as well; this keeps the dashboard clean too. The
// chat goes with it (see game/playerMessages.ts). The menu's Feedback and
// Suggest a word sheets stay, so their UI can be seen on a preview; what they
// send rides the event log, which is off here (see Root.tsx).
if (isVercelHost(window.location.hostname)) {
  setReporting(false)
  setPlayerMessages(false)
}

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

// Before the first render: a player who set "Show username" before the share
// name test arrived stays out of it for good (see game/shareName.ts).
excludeShareNameIfChosen()

// Muse AI's `?visitor=` tag, kept before anything can navigate the query away
// (see game/visitor.ts).
visitorTag(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
import { assignStartingMode } from './game/onboarding'
import { assignUiVariant } from './game/uiVariant'
import { visitorTag } from './game/visitor'

// Before the first render: a brand-new player's starting mode decides which
// progress and scoring the puzzle loads with (see game/onboarding.ts).
assignStartingMode(window.location.search)

// The play-screen experiment (see game/uiVariant.ts). On the root element so
// the stylesheet can gate the new layout, including the floating controls that
// sit outside the play column.
document.documentElement.dataset.ui = assignUiVariant(window.location.search)

// Muse AI's `?visitor=` tag, kept before anything can navigate the query away
// (see game/visitor.ts).
visitorTag(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

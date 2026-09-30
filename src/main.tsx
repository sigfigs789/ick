import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
import { assignStartingMode } from './game/onboarding'

// Before the first render: a brand-new player's starting mode decides which
// progress and scoring the puzzle loads with (see game/onboarding.ts).
assignStartingMode(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

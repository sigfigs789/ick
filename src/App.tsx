import { useState } from "react";
import { FragmentDisplay } from "./components/FragmentDisplay";
import { WordSlots } from "./components/WordSlots";
import { SubmitForm } from "./components/SubmitForm";
import { FeedbackRegion } from "./components/FeedbackRegion";
import { StreakDisplay } from "./components/StreakDisplay";
import { ResultsPanel } from "./components/ResultsPanel";
import { InstructionsModal } from "./components/InstructionsModal";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";

export default function App() {
  const { fragment, progress, streak, feedback, submitWord } = useDailyPuzzle();
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Ick</h1>
        <button
          type="button"
          className="app__help-button"
          onClick={() => setShowInstructions(true)}
          aria-label="How to play"
        >
          ?
        </button>
      </header>

      <main>
        <FragmentDisplay fragment={fragment} />
        <WordSlots acceptedWords={progress.acceptedWords} />

        {!progress.completed && (
          <SubmitForm fragment={fragment} disabled={progress.completed} onSubmit={submitWord} />
        )}
        <FeedbackRegion feedback={feedback} />

        {!progress.completed && <StreakDisplay streak={streak} />}

        {progress.completed && (
          <ResultsPanel fragment={fragment} words={progress.acceptedWords} streak={streak} />
        )}
      </main>

      <InstructionsModal open={showInstructions} onClose={() => setShowInstructions(false)} />
    </div>
  );
}

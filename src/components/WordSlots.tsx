import { RarityBadge } from "./RarityBadge";
import type { AcceptedWord } from "../game/types";

interface Props {
  acceptedWords: AcceptedWord[];
}

const SLOT_COUNT = 3;

export function WordSlots({ acceptedWords }: Props) {
  return (
    <ol className="word-slots" aria-label="Your three words">
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const word = acceptedWords[i];
        return (
          <li
            key={i}
            className={`word-slot${word ? " word-slot--filled" : ""}`}
            aria-label={word ? `Word ${i + 1}: ${word.word}, ${word.rarity}` : `Word ${i + 1}: not yet found`}
          >
            {word ? (
              <>
                <span className="word-slot__word">{word.word}</span>
                <RarityBadge rarity={word.rarity} />
              </>
            ) : (
              <span className="word-slot__placeholder" aria-hidden="true">
                {i + 1}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

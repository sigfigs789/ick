import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { REJECTION_LEADS } from '../../../src/game/submit';
import type { RejectionReason } from '../../../src/game/types';
import type { Feedback } from '../../../src/hooks/useDailyPuzzle';
import { useTheme } from '../theme/useTheme';

/**
 * The one verdict that means "we don't have this word": not on the curated
 * list, and no reference the game consults could place it either.
 *
 * Everything else -- a proper noun, an archaic form, a likely typo, a word
 * already used -- is a different answer that used to wear the same red, and
 * players read the colour rather than the sentence, so every rejection landed
 * as "not a word". The curated-list miss keeps the red; a rejection with
 * something more specific to say takes the caution yellow, which is the signal
 * that the words are worth reading.
 */
const CURATED_LIST_MISS: RejectionReason = 'not-a-word';

const VISIBLE_MS = 12000;
/** The website's --ease-standard, which the toast fades on. */
const EASE_STANDARD = Easing.bezier(0.2, 0.8, 0.2, 1);
const FADE_MS = 350;

interface Props {
  feedback: Feedback | null;
  /**
   * A note about a live lookup: the in-progress verb while it runs, its past
   * tense once it answers. Sits above the verdict, directly under the input.
   */
  note?: string | null;
  /**
   * Whether to hold the toast's slot open. True while the puzzle is playable,
   * so a verdict arriving doesn't shove the screen down; false once the guess
   * form is gone, when no verdict can arrive and the reserved slot is just a
   * hole.
   */
  reserveSpace?: boolean;
  onWordRules: () => void;
  /**
   * Whether the note stays up once the lookup answers. Off on the play screen:
   * the settled note ("Not found") only repeated the verdict the toast under
   * it gives in full, so there the note shows only while it is still waiting.
   */
  settledNote?: boolean;
  /** How long a verdict stays up, in ms. */
  visibleMs?: number;
}

/** The verdict on the last guess, and whatever the live lookup has to say. */
export function FeedbackRegion({
  feedback,
  note,
  reserveSpace = true,
  onWordRules,
  settledNote = true,
  visibleMs = VISIBLE_MS,
}: Props) {
  const theme = useTheme();

  const [shownFlag, setShownFlag] = useState(false);
  const [shown] = useState(() => new Animated.Value(0));
  const [noteShown] = useState(() => new Animated.Value(0));

  const feedbackKey = feedback?.key ?? null;

  // A new verdict opens the toast's padding at once, in the same render.
  const [lastKey, setLastKey] = useState(feedbackKey);
  if (lastKey !== feedbackKey) {
    setLastKey(feedbackKey);
    if (feedbackKey !== null) setShownFlag(true);
  }

  useEffect(() => {
    if (feedbackKey === null) return;
    Animated.timing(shown, {
      toValue: 1,
      duration: FADE_MS,
      easing: EASE_STANDARD,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => {
      Animated.timing(shown, {
        toValue: 0,
        duration: FADE_MS,
        easing: EASE_STANDARD,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShownFlag(false);
      });
    }, visibleMs);
    return () => clearTimeout(timer);
    // Timed from the verdict's arrival; a change of length alone is not news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackKey, shown]);

  // The note holds while the lookup is still running -- it has no verdict to
  // outlive yet. Once one lands it fades on the same clock as the verdict, so
  // the two always clear together.
  useEffect(() => {
    if (!note) {
      noteShown.setValue(0);
      return;
    }
    Animated.timing(noteShown, {
      toValue: 1,
      duration: FADE_MS,
      easing: EASE_STANDARD,
      useNativeDriver: true,
    }).start();
    if (feedbackKey === null) return;
    const timer = setTimeout(() => {
      Animated.timing(noteShown, {
        toValue: 0,
        duration: FADE_MS,
        easing: EASE_STANDARD,
        useNativeDriver: true,
      }).start();
    }, visibleMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, feedbackKey, noteShown]);

  // A note still in flight ends in an ellipsis; a settled one ("Found it!")
  // doesn't. Only the pending form gets the animated dots.
  const pendingStem = note?.endsWith('…') ? note.slice(0, -1) : null;
  const showNote = Boolean(note) && (settledNote || pendingStem !== null);

  /*
   * The lead is lifted out of the sentence it opens, so a skim carries the
   * verdict on its own. Split off the message rather than rebuilt from parts,
   * so the toast can only ever show the exact sentence the rest of the game
   * uses.
   */
  const lead = feedback?.reason ? REJECTION_LEADS[feedback.reason] : undefined;
  const rest =
    feedback && lead && feedback.message.startsWith(lead)
      ? feedback.message.slice(lead.length)
      : null;

  const specific =
    feedback?.kind === 'rejected' &&
    feedback.reason !== undefined &&
    feedback.reason !== CURATED_LIST_MISS;

  const palette = !feedback
    ? null
    : feedback.kind === 'accepted'
      ? { bg: theme.successBg, fg: theme.successFg }
      : specific
        ? { bg: theme.cautionBg, fg: theme.cautionFg }
        : { bg: theme.dangerBg, fg: theme.dangerFg };

  return (
    <>
      {showNote && (
        <Animated.View
          style={[styles.noteRow, { opacity: noteShown }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.note, styles.noteStem, { color: theme.fgFaint }]}>
            {pendingStem ?? note}
          </Text>
          {pendingStem !== null && <Dots color={theme.fgFaint} />}
        </Animated.View>
      )}

      <Animated.View
        style={[
          reserveSpace ? styles.toast : styles.toastCollapsed,
          shownFlag && styles.toastShown,
          palette && { backgroundColor: palette.bg },
          {
            opacity: shown,
            transform: [
              { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
            ],
          },
        ]}
        accessibilityLiveRegion="polite"
      >
        {feedback && palette && (
          <Text style={[styles.message, { color: palette.fg }]}>
            {rest !== null ? (
              <>
                <Text style={styles.lead}>{lead}</Text>
                {rest}
              </>
            ) : (
              feedback.message
            )}
            {feedback.kind === 'rejected' && (
              <>
                {'  '}
                <Text
                  onPress={onWordRules}
                  accessibilityRole="button"
                  suppressHighlighting={false}
                  style={styles.more}
                >
                  More info
                </Text>
              </>
            )}
          </Text>
        )}
      </Animated.View>
    </>
  );
}

/** The pending note's three dots, blinking out and back in turn. */
function Dots({ color }: { color: string }) {
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(1)));
  useEffect(() => {
    // live-note-dot over 1.2s: gone from 20% to 40%, back by 60%; each dot
    // 0.2s behind the one before.
    const step = 240;
    const loops = dots.map((value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 0, duration: step, useNativeDriver: true }),
          Animated.delay(step),
          Animated.timing(value, { toValue: 1, duration: step, useNativeDriver: true }),
          Animated.delay(step * 2),
        ])
      )
    );
    const timers = loops.map((loop, i) => setTimeout(() => loop.start(), i * 200));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
    };
  }, [dots]);
  return (
    <>
      {dots.map((opacity, i) => (
        <Animated.Text
          key={i}
          style={[styles.note, { color, opacity }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          .
        </Animated.Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  noteRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  noteStem: {
    flexShrink: 1,
  },
  note: {
    fontSize: 12.8,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  /* .play .feedback: a held slot, 1rem above the guesses. */
  toast: {
    minHeight: 12.8,
    marginTop: 4.8,
    marginBottom: 16,
    borderRadius: 8,
  },
  toastCollapsed: {
    borderRadius: 8,
  },
  toastShown: {
    paddingVertical: 8,
    paddingHorizontal: 11.2,
  },
  message: {
    fontSize: 14.4,
    lineHeight: 20,
    fontWeight: '600',
  },
  lead: {
    fontWeight: '800',
  },
  more: {
    fontSize: 12.8,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
});

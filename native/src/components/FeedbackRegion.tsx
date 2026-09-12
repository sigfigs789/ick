import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { REJECTION_LEADS } from '../../../src/game/submit';
import type { RejectionReason } from '../../../src/game/types';
import type { Feedback } from '../../../src/hooks/useDailyPuzzle';
import { radius, space } from '../theme/tokens';
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

interface Props {
  feedback: Feedback | null;
  /**
   * A note about a live lookup: the in-progress verb while it runs, its past
   * tense once it answers. Sits above the verdict, directly under the input.
   */
  note?: string | null;
  onWordRules: () => void;
}

/** The verdict on the last guess, and whatever the live lookup has to say. */
export function FeedbackRegion({ feedback, note, onWordRules }: Props) {
  const theme = useTheme();

  const [shown] = useState(() => new Animated.Value(0));
  const [noteShown] = useState(() => new Animated.Value(0));

  const feedbackKey = feedback?.key ?? null;

  useEffect(() => {
    if (feedbackKey === null) return;
    shown.setValue(0);
    Animated.timing(shown, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => {
      Animated.timing(shown, {
        toValue: 0,
        duration: 400,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedbackKey, shown]);

  // The note holds while the lookup is still running -- it has no verdict to
  // outlive yet. Once one lands it fades on the same clock as the verdict, so
  // the two always clear together.
  useEffect(() => {
    if (!note) {
      noteShown.setValue(0);
      return;
    }
    noteShown.setValue(1);
    if (feedbackKey === null) return;
    const timer = setTimeout(() => {
      Animated.timing(noteShown, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [note, feedbackKey, noteShown]);

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

  const palette =
    feedback?.kind === 'accepted'
      ? { bg: theme.successBg, fg: theme.successFg }
      : specific
        ? { bg: theme.cautionBg, fg: theme.cautionFg }
        : { bg: theme.dangerBg, fg: theme.dangerFg };

  return (
    <View style={styles.wrap}>
      {note && (
        <Animated.Text
          style={[styles.note, { color: theme.fgMuted, opacity: noteShown }]}
          accessibilityLiveRegion="polite"
        >
          {note}
        </Animated.Text>
      )}

      {feedback && (
        <Animated.View
          style={[styles.toast, { backgroundColor: palette.bg, opacity: shown }]}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <Text style={[styles.message, { color: palette.fg }]}>
            {rest !== null ? (
              <>
                <Text style={styles.lead}>{lead}</Text>
                {rest}
              </>
            ) : (
              feedback.message
            )}
          </Text>

          {feedback.kind === 'rejected' && (
            <Pressable
              onPress={onWordRules}
              accessibilityRole="button"
              hitSlop={space.sm}
              style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.moreText, { color: palette.fg }]}>More info</Text>
            </Pressable>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    // One line of toast, reserved rather than collapsing: a verdict arriving
    // must not shove the guess log down the screen under the player's thumb.
    // Exactly one line, because the empty gap is paid for on every screen the
    // player looks at and the overflow case is a second line of a toast that
    // is already there.
    minHeight: 36,
  },
  note: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  lead: {
    fontWeight: '800',
  },
  more: {
    paddingVertical: 2,
  },
  moreText: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildShareText, type RevealMode } from '../../../src/game/share';
import { windowTotals } from '../../../src/game/totals';
import { loadReveal, saveReveal } from '../../../src/game/reveal';
import type { AcceptedWord, StreakState } from '../../../src/game/types';
import { signalTap } from '../host/feedback';
import { shareText as openShareSheet } from '../host/share';
import { font, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  /** Whether this is the current puzzle, which is what lets the result say "Today". */
  isToday?: boolean;
  onLeaderboard?: () => void;
}

// Naming answers is opt-in so a shared result stays spoiler-free by default.
const REVEAL_OPTIONS: { value: RevealMode; label: string }[] = [
  { value: 'none', label: 'Hide' },
  { value: 'top', label: 'Top' },
  { value: 'all', label: 'All' },
];

/**
 * The shareable result, available from the first banked word.
 *
 * Not from the end of the puzzle: sharing used to be the reward for declaring
 * the day over, so a player sitting on the best word they would find all week
 * had to close the puzzle irreversibly to post it -- and nothing was ever at
 * stake in the declaration, because the streak, the counters and the board all
 * bank on the word itself.
 *
 * One share button rather than the website's two. A phone has a real share
 * sheet, which already lists every destination the player has, chosen by them;
 * the separate "post to X" button was a shortcut past a sheet that no longer
 * needs shortcutting (see src/host/share.ts).
 */
export function ResultsPanel({ date, drop, words, streak, isToday = false, onLeaderboard }: Props) {
  const theme = useTheme();

  // Starts from the player's last choice, "Top" until they make one (see
  // src/game/reveal.ts).
  const [reveal, setRevealState] = useState<RevealMode>(loadReveal);
  const setReveal = (next: RevealMode) => {
    setRevealState(next);
    saveReveal(next);
  };
  const [shared, setShared] = useState(false);

  // Read from this device's own history rather than the board: the numbers are
  // the boards' arithmetic, but a player who never joined one still gets them,
  // and nothing here waits on the network to draw a preview.
  const totals = windowTotals(date);

  const preview = buildShareText(date, drop, words, {
    reveal,
    streak: streak.currentStreak,
    weekTotal: totals.week,
    monthTotal: totals.month,
    isToday,
  });

  // What actually leaves the app carries the attribution code the website's
  // copied result does, so an arrival from a shared phone result is
  // distinguishable from one typed in.
  const outgoing = buildShareText(date, drop, words, {
    reveal,
    streak: streak.currentStreak,
    weekTotal: totals.week,
    monthTotal: totals.month,
    isToday,
    source: 'share',
  });

  async function share() {
    signalTap();
    const done = await openShareSheet(outgoing);
    if (!done) return;
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  return (
    <View
      style={[styles.panel, { backgroundColor: theme.bgInset, borderColor: theme.border }]}
      accessibilityLabel="Share result"
    >
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLegend, { color: theme.fgMuted }]}>Show answers</Text>
        <View style={[styles.segments, { borderColor: theme.border, backgroundColor: theme.cardBg }]}>
          {REVEAL_OPTIONS.map((option) => {
            const current = option.value === reveal;
            return (
              <Pressable
                key={option.value}
                onPress={() => setReveal(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: current }}
                accessibilityLabel={`Show answers: ${option.label}`}
                style={[styles.segment, current && { backgroundColor: theme.accent }]}
              >
                <Text
                  style={[styles.segmentText, { color: current ? theme.accentFg : theme.fgMuted }]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text
        style={[styles.preview, { color: theme.fg, backgroundColor: theme.cardBg }]}
        // The preview is a picture of the text the share sheet will carry, and
        // reading it aloud line by line would announce the result twice.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {preview}
      </Text>

      <Pressable
        onPress={share}
        accessibilityRole="button"
        accessibilityLabel="Share your result"
        style={({ pressed }) => [
          styles.share,
          { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.shareText, { color: theme.accentFg }]}>
          {shared ? 'Shared!' : 'Share'}
        </Text>
      </Pressable>

      {onLeaderboard && (
        // The second way in, and the one that gets used: a finished puzzle is
        // the moment a player wants to know where the score put them.
        <Pressable
          onPress={() => {
            signalTap();
            onLeaderboard();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.leaderboard,
            { borderColor: theme.borderStrong, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.leaderboardText, { color: theme.fg }]}>See the leaderboard</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  toggleLegend: {
    fontSize: 13,
    fontWeight: '700',
  },
  segments: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
  },
  segment: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  preview: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 18,
    borderRadius: radius.sm,
    padding: space.md,
  },
  share: {
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  shareText: {
    fontSize: 16,
    fontWeight: '700',
  },
  leaderboard: {
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  leaderboardText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

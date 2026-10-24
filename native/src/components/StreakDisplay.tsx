import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  atRisk,
  freezesOn,
  resting,
  savedFreezeCovering,
  wasFrozen,
  weekdayRestProgress,
} from '../../../src/game/streakFreeze';
import type { StreakState } from '../../../src/game/types';
import { useTheme } from '../theme/useTheme';
import { BadgePopup, RestDayBadge } from './RestDayBadge';

/** How saved freezes work, for the freeze badge's popup. */
const FREEZE_RULES =
  '🧊 saves your streak on a missed day. Earn one on day 3, then every 7 days. ' +
  'Hold 1, or 2 after a 14 day streak.';

function freezeSummary(banked: number, cap: number): string {
  if (banked === 0) return 'No 🧊 acquired';
  // Held from when the limit was three; kept, but no more are earned past it.
  if (banked > cap) return `${banked} 🧊 acquired, over the limit of ${cap}`;
  return `${banked} of ${cap} 🧊 acquired`;
}

/** The website's .streak-display font size, which the badges match. */
const TEXT_SIZE = 14.4;

/**
 * The 🧊 saved/max badge. Pressing it opens a popup with the count and the
 * rules; pressing it, or the popup, again closes it.
 */
function FreezeBadge({ banked, cap }: { banked: number; cap: number }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <BadgePopup
      open={open}
      onToggle={() => setOpen((was) => !was)}
      maxWidth={272}
      title={freezeSummary(banked, cap)}
      text={FREEZE_RULES}
      accessibilityLabel={`Streak freezes: ${banked} of ${cap}`}
      style={styles.freezes}
    >
      <Text style={styles.text}>🧊</Text>
      <Text style={[styles.count, styles.freezeCount, { color: theme.fg }]}>
        {banked}/{cap}
      </Text>
    </BadgePopup>
  );
}

interface Props {
  streak: StreakState;
  totalRarity?: number;
  /** Puzzle date, which decides whether today's freeze state is shown. */
  date?: string;
  /** Whether `date` is today's puzzle, which is when a freeze spent yesterday is news. */
  isToday?: boolean;
  /**
   * The play screen: leave out what would only be zeros -- the freeze badge
   * until the player can hold a freeze, the total until a word is banked, and
   * the whole strip for a player with neither a streak, a freeze cap, nor a
   * word yet.
   */
  hideEmpty?: boolean;
  /** Whether this puzzle has a banked word, for `hideEmpty`. */
  hasWords?: boolean;
  /** For the guess log's completion block, which drops the top padding. */
  style?: StyleProp<ViewStyle>;
}

/**
 * How the streak stands, and this puzzle's total: the website's two-line
 * strip under the guesses (src/components/StreakDisplay.tsx), centred and
 * borderless.
 */
export function StreakDisplay({
  streak,
  totalRarity = 0,
  date,
  isToday = false,
  hideEmpty = false,
  hasWords = true,
  style,
}: Props) {
  const theme = useTheme();
  // One icon for how the streak stands, as the streak board marks it: 😴 on
  // an earned weekend day not played yet, which cannot end the streak; ⏳ when
  // missing today ends the streak, every saved freeze spent; 🧊 while a saved
  // freeze is covering a missed day with one left for today, until today is
  // played; 🔥 otherwise. A past puzzle whose day a freeze covered shows 🧊
  // too: that day the streak was kept by a freeze, not by play.
  const restDay = isToday && date !== undefined && resting(streak, date);
  const frozen = !restDay && isToday && date !== undefined && savedFreezeCovering(streak, date);
  const risky = !restDay && isToday && date !== undefined && atRisk(streak, date);
  const coveredDay = !isToday && date !== undefined && wasFrozen(streak, date);
  const icon = risky ? '⏳' : frozen || coveredDay ? '🧊' : streak.currentStreak >= 2 ? '🔥' : null;
  // The days played towards the next lazy weekend (a pie, or
  // 😴 once unlocked), beside the freezes. Only for a live streak, which is
  // what a lazy weekend keeps.
  const week =
    isToday && date !== undefined && streak.currentStreak > 0
      ? weekdayRestProgress(streak, date)
      : null;
  // A past puzzle shows the freezes held on its day; today's shows today's.
  const { banked, cap } = freezesOn(streak, isToday ? undefined : date);
  // Hidden only before the player can hold a freeze at all. The cap is set by
  // the longest streak ever, so a player whose streak has ended still has one
  // to show, and the row stays for it.
  const showFreezes = !hideEmpty || cap > 0;
  const showTotal = !hideEmpty || hasWords;
  const showStreak = !hideEmpty || streak.currentStreak > 0 || frozen || risky || cap > 0;
  if (!showStreak && !showTotal) return null;

  const summary =
    `Current streak: ${streak.currentStreak} days. ` +
    (restDay ? "Lazy weekend: skipping today can't break your streak. " : '') +
    (coveredDay ? 'A freeze kept your streak alive on this day. ' : '') +
    (frozen ? 'A saved freeze is covering your streak. ' : '') +
    (risky ? 'Play today to keep your streak. ' : '') +
    `Streak freezes: ${banked} of ${cap}. ` +
    `This puzzle's total score: ${totalRarity.toFixed(1)}.`;

  return (
    <View style={[styles.wrap, style]}>
      {showStreak && (
        <View style={styles.row}>
          {restDay ? (
            <RestDayBadge fontSize={TEXT_SIZE} />
          ) : (
            icon && (
              <Text style={styles.text} accessibilityElementsHidden importantForAccessibility="no">
                {icon}
              </Text>
            )
          )}
          {/* The whole strip in one sentence for a screen reader, carried by
              the count; the badges either side are read as their controls. */}
          <View style={styles.row} accessible accessibilityLabel={summary}>
            <Text style={[styles.count, { color: theme.fg }]}>{streak.currentStreak}</Text>
            <Text style={[styles.text, { color: theme.fgMuted }]}>day streak</Text>
          </View>
          {showFreezes && <FreezeBadge banked={banked} cap={cap} />}
          {week && (
            <RestDayBadge
              played={week.played}
              reachable={week.reachable}
              fontSize={TEXT_SIZE}
              style={styles.week}
            />
          )}
        </View>
      )}
      {showTotal && (
        <View
          style={styles.scores}
          accessible
          accessibilityLabel={`This puzzle's total score: ${totalRarity.toFixed(1)}`}
        >
          <Text style={[styles.text, { color: theme.fgMuted }]}>Total</Text>
          <Text style={[styles.count, { color: theme.fg }]}>{totalRarity.toFixed(1)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /* .streak-display: a centred stack, 0.25rem apart, 0.3rem of air above. */
  wrap: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 4.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  text: {
    fontSize: TEXT_SIZE,
  },
  count: {
    fontSize: 16,
    fontWeight: '800',
  },
  freezes: {
    marginLeft: 4,
  },
  freezeCount: {
    marginLeft: 4,
  },
  week: {
    marginLeft: 8,
  },
  scores: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6.4,
  },
});

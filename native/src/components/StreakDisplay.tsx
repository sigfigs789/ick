import { StyleSheet, Text, View } from 'react-native';
import { formatScore } from '../../../src/game/dictionary';
import type { StreakState } from '../../../src/game/types';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** What the two tier counters count, said once for the label and the caption. */
const CRUSHED_IT_TITLE = 'Days you found a Rare word or better';
const ELITE_TITLE = 'Days you found an Extremely Rare word or better';

interface Props {
  streak: StreakState;
  totalRarity?: number;
  topRarity?: number;
  /** The puzzle's date, so the top score formats for the system in effect that day. */
  date?: string;
}

/** The running tallies: the streak, the two tier counters, and today's scores. */
export function StreakDisplay({ streak, totalRarity = 0, topRarity = 0, date }: Props) {
  const theme = useTheme();

  return (
    <View
      style={[styles.card, { backgroundColor: theme.bgInset, borderColor: theme.border }]}
      accessible
      accessibilityLabel={
        `Current streak: ${streak.currentStreak} days. ` +
        `${CRUSHED_IT_TITLE}: ${streak.crushedIt}. ` +
        `${ELITE_TITLE}: ${streak.elite}. ` +
        `This puzzle's total score: ${totalRarity.toFixed(1)}. ` +
        `Rarest word so far: ${formatScore(topRarity, date)}.`
      }
    >
      <View style={styles.row}>
        <Stat
          value={`${streak.currentStreak >= 2 ? '🔥 ' : ''}${streak.currentStreak}`}
          label="day streak"
        />
        <Stat value={String(streak.crushedIt)} label="Crushed it" />
        <Stat value={String(streak.elite)} label="Elite" />
      </View>

      <View style={[styles.scores, { borderTopColor: theme.border }]}>
        <Score label="Total" value={totalRarity.toFixed(1)} />
        <Score label="Top" value={formatScore(topRarity, date)} />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    // Hidden from the reader because the card above says all of this in one
    // sentence -- letting it through as well would read the same numbers twice,
    // once as a sentence and once as loose fragments.
    <View style={styles.stat} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.statValue, { color: theme.fg }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.fgMuted }]}>{label}</Text>
    </View>
  );
}

function Score({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.score} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.scoreLabel, { color: theme.fgMuted }]}>{label}</Text>
      <Text style={[styles.scoreValue, { color: theme.fg }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stat: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  scores: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
  score: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  scoreValue: {
    fontSize: 16,
    fontWeight: '800',
  },
});

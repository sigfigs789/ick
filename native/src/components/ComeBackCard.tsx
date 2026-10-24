import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { syncAchievements } from '../../../src/game/achievements';
import { streakGoal } from '../../../src/game/comeBack';
import type { StreakState } from '../../../src/game/types';
import { useTheme } from '../theme/useTheme';

/** The website's --ease-standard, cubic-bezier(0.2, 0.8, 0.2, 1). */
const EASE_STANDARD = Easing.bezier(0.2, 0.8, 0.2, 1);

interface Props {
  streak: StreakState;
  /** The puzzle on screen. */
  date: string;
}

/**
 * Under the streak strip once today's word is banked: what playing tomorrow
 * is worth, in one line (see game/comeBack.ts for why it is here). No 🔥 of its
 * own -- the strip right above it already wears one -- and no box: a card there
 * restated the streak and the 🧊 a second time.
 *
 * The website draws this for half its players as an experiment. There is no
 * one here to measure a draw (reporting is off in the app), so, like the
 * Reddit post, it always shows the line.
 */
export function ComeBackCard({ streak, date }: Props) {
  const theme = useTheme();
  // The achievements still locked, for when nothing nearer is ahead. Memoized:
  // reading them walks the stored history.
  const goal = useMemo(
    () => streakGoal(streak, date, syncAchievements(streak).filter((status) => !status.earnedOn)),
    [streak, date],
  );

  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(enter, {
      toValue: 1,
      duration: 400,
      easing: EASE_STANDARD,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [enter]);

  if (goal === null) return null;
  return (
    <Animated.Text
      style={[
        styles.goal,
        {
          color: theme.fg,
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
      accessibilityLabel={`Tomorrow's drop: ${goal}`}
    >
      {goal}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  goal: {
    marginTop: 2.4,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 13.6,
    lineHeight: 19,
    fontWeight: '600',
  },
});

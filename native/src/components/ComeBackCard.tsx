import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { syncAchievements } from '../../../src/game/achievements';
import { comeBackGoal } from '../../../src/game/comeBack';
import type { StreakState } from '../../../src/game/types';
import { useTheme } from '../theme/useTheme';
import { BadgePopup } from './RestDayBadge';

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
 *
 * A line naming a 🧊 freeze or a lazy weekend can be pressed for a popup
 * saying what that is (see `comeBackGoal`), as the badges above it open theirs.
 */
export function ComeBackCard({ streak, date }: Props) {
  const theme = useTheme();
  // The achievements still locked, for when nothing nearer is ahead. Memoized:
  // reading them walks the stored history. The suggestion badges are left out:
  // they are not won by coming back to play.
  const goal = useMemo(
    () =>
      comeBackGoal(
        streak,
        date,
        syncAchievements(streak).filter(
          (status) => !status.earnedOn && !status.achievement.viaSuggestions,
        ),
      ),
    [streak, date],
  );

  const [open, setOpen] = useState(false);
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
  const { line, explainer } = goal;
  const label = `Tomorrow's drop: ${line}`;
  return (
    <Animated.View
      style={[
        styles.wrap,
        // Over the content below while its popup is open.
        open && styles.wrapOpen,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      {explainer ? (
        <BadgePopup
          open={open}
          onToggle={() => setOpen((was) => !was)}
          maxWidth={272}
          title={explainer.title}
          text={explainer.text}
          accessibilityLabel={label}
        >
          <Text style={[styles.goal, styles.explained, { color: theme.fg }]}>{line}</Text>
        </BadgePopup>
      ) : (
        <Text style={[styles.goal, { color: theme.fg }]} accessibilityLabel={label}>
          {line}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: 2.4,
    marginBottom: 16,
  },
  wrapOpen: {
    zIndex: 20,
    elevation: 20,
  },
  goal: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: 13.6,
    lineHeight: 19,
    fontWeight: '600',
  },
  /* .come-back__button: a dotted underline marks the line as pressable. */
  explained: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
});

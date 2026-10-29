import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { celebrationShareLine, type EarnedAchievement } from '../../../src/game/achievements';
import { useTheme } from '../theme/useTheme';
import { CelebrationCard, Highlight } from './CelebrationCard';
import { ConfettiBurst, useReduceMotion } from './ConfettiBurst';

/** The website's ink violet, hsl(265 72% 58%). */
const VIOLET = '265, 72%, 58%';
/** The badge's gold rim and face. */
const GOLD_RIM = 'hsl(45, 92%, 52%)';
const GOLD_FACE = 'hsl(45, 100%, 82%)';

/** The website's pop-in, cubic-bezier(0.2, 1.6, 0.4, 1). */
const POP = Easing.bezier(0.2, 1.6, 0.4, 1);

/** The most badges the card names; the rest are left to Stats. */
const MOST_SHOWN = 3;

/**
 * The moment a word earns an achievement (see game/achievements.ts) -- a port
 * of the website's AchievementCelebration.
 *
 * The improving average's card, in ink violet, with the badge itself as the
 * centrepiece and gold confetti falling around it. It floats over the puzzle
 * and goes by itself or on a tap. A word that earns several at once (a first
 * word that is also a Legend) lists them all on the one card.
 *
 * The same card welcomes a returning player's badges that were never announced
 * (see `achievementsToCatchUp`): `total` is how many there are, of which
 * `achievements` is the few worth naming, and the rest are left to Stats.
 * No card names more than three, however many a word earns.
 *
 * The website's turning rays and the sheen across the card are CSS gradients
 * React Native does not draw; the badge's pop is kept, which is the part that
 * says something was handed over.
 */
export function AchievementCelebration({
  achievements: earned,
  total: given = earned.length,
  onDone,
}: {
  achievements: readonly EarnedAchievement[];
  total?: number;
  onDone: () => void;
}) {
  const achievements = earned.slice(0, MOST_SHOWN);
  const total = Math.max(given, earned.length);
  const theme = useTheme();
  // Read as the card opens, so this player's own report never changes it.
  const [share] = useState(() =>
    achievements.length === 1 && total === 1 ? celebrationShareLine(achievements[0].id) : null
  );
  if (achievements.length === 0) return null;
  const [only] = achievements;
  const several = achievements.length > 1;
  const more = total - achievements.length;
  const eyebrow = (
    <Text style={[styles.eyebrow, { color: theme.dark ? 'hsl(265, 90%, 78%)' : 'hsl(265, 72%, 52%)' }]}>
      {total > 1 ? `${total} achievements unlocked` : 'Achievement unlocked'}
    </Text>
  );
  return (
    <>
      <ConfettiBurst grand />
      <CelebrationCard
        accent={VIOLET}
        eyebrow={eyebrow}
        centerpiece={
          several ? (
            <View style={styles.list}>
              {achievements.map((achievement, index) => (
                <Pop key={achievement.id} delay={Math.min(index, 2) * 150} style={styles.item}>
                  <View style={styles.itemIcon}>
                    <Text style={styles.itemEmoji}>{achievement.icon}</Text>
                  </View>
                  <Text style={[styles.itemTitle, { color: theme.fg }]}>{achievement.title}</Text>
                </Pop>
              ))}
            </View>
          ) : (
            <Pop delay={200} style={styles.medal}>
              <Text style={styles.medalEmoji} accessibilityElementsHidden importantForAccessibility="no">
                {only.icon}
              </Text>
            </Pop>
          )
        }
        from="below"
        enterMs={520}
        title={several ? undefined : only.title}
        footnote={
          more > 0
            ? `And ${more} more. See them all on your Stats page.`
            : several
              ? "They're on your Stats page."
              : "It's on your Stats page."
        }
        onDone={onDone}
      >
        {several ? undefined : (
          <>
            {only.description}
            {only.word && `\nWith ${only.word}`}
            {share && (
              <>
                {'\n'}
                <Highlight color={theme.dark ? 'hsl(265, 90%, 78%)' : 'hsl(265, 72%, 52%)'}>{share}</Highlight>
              </>
            )}
          </>
        )}
      </CelebrationCard>
    </>
  );
}

/** The website's `achievement-pop`: in from small and turned, overshooting into place. */
function Pop({
  delay,
  style,
  children,
}: {
  delay: number;
  style: React.ComponentProps<typeof View>['style'];
  children: React.ReactNode;
}) {
  const reduced = useReduceMotion();
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(enter, { toValue: 1, duration: 650, easing: POP, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [enter, delay]);
  const motion = reduced
    ? undefined
    : {
        opacity: enter.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' as const }),
        transform: [
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
          { rotate: enter.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) },
        ],
      };
  return <Animated.View style={[style, motion]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.44,
    textTransform: 'uppercase',
  },
  medal: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 68,
    height: 68,
    marginTop: 5.6,
    marginBottom: 2.4,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: GOLD_RIM,
    backgroundColor: GOLD_FACE,
    boxShadow: `0 0 0 4px hsla(${VIOLET}, 0.25), 0 0 26px hsla(45, 92%, 52%, 0.6)`,
  },
  medalEmoji: {
    fontSize: 35,
    lineHeight: 42,
  },
  list: {
    gap: 5.6,
    marginTop: 6.4,
    marginBottom: 1.6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9.6,
  },
  itemIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 35,
    height: 35,
    borderRadius: 17.5,
    borderWidth: 2,
    borderColor: GOLD_RIM,
    backgroundColor: GOLD_FACE,
  },
  itemEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  itemTitle: {
    fontSize: 17.6,
    fontWeight: '800',
  },
});

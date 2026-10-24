import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WelcomeBack } from '../../../src/game/streakFreeze';
import { signalTap } from '../host/feedback';
import { useTheme } from '../theme/useTheme';
import { cardShadow } from './CelebrationCard';

/** The website's --ease-standard, cubic-bezier(0.2, 0.8, 0.2, 1). */
const EASE_STANDARD = Easing.bezier(0.2, 0.8, 0.2, 1);

interface Props {
  welcome: WelcomeBack;
  onDismiss: () => void;
}

/**
 * The card over the input for a player back after their streak ended (see
 * `welcomeBack` in game/streakFreeze.ts). The streak strip below reads 0 for
 * them, so this says what they had and what starting again brings: a saved
 * freeze on today's first word, when one is due. Gone once a word is played,
 * when the freeze badge shows the freeze itself.
 *
 * In the flow, so it pushes the input down rather than covering the drop.
 */
export function WelcomeBackCard({ welcome, onDismiss }: Props) {
  const theme = useTheme();
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const run = Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: EASE_STANDARD,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [enter]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          borderColor: theme.border,
          backgroundColor: theme.cardBg,
          boxShadow: cardShadow(theme.dark),
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.fg }]}>👋 Welcome back!</Text>
        <Text style={[styles.line, { color: theme.fg }]}>
          Your best streak was <Text style={styles.strong}>{welcome.best} days</Text>.{' '}
          {welcome.freeze
            ? 'Play today to start a new one, and earn a 🧊 streak freeze to cover a missed day.'
            : 'Play today to start a new one.'}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          signalTap();
          onDismiss();
        }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        style={styles.close}
      >
        {({ pressed }) => (
          <Text style={[styles.closeLabel, { color: pressed ? theme.fg : theme.fgMuted }]}>×</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 11.2,
    paddingHorizontal: 13.6,
    borderWidth: 1,
    borderRadius: 10.4,
  },
  copy: {
    flex: 1,
  },
  title: {
    marginBottom: 3.2,
    fontSize: 14.72,
    lineHeight: 20.6,
    fontWeight: '800',
  },
  line: {
    fontSize: 14.72,
    lineHeight: 20.6,
  },
  strong: {
    fontWeight: '700',
  },
  close: {
    minWidth: 28,
    minHeight: 28,
    marginTop: -4.8,
    marginRight: -6.4,
    marginBottom: -4.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: {
    fontSize: 17.6,
    lineHeight: 20,
  },
});

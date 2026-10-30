import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { signalTap } from '../host/feedback';
import { useTheme } from '../theme/useTheme';
import { cardShadow } from './CelebrationCard';

/** The website's --ease-standard, cubic-bezier(0.2, 0.8, 0.2, 1). */
const EASE_STANDARD = Easing.bezier(0.2, 0.8, 0.2, 1);

interface Props {
  words: readonly string[];
  /** The player's first accepted word, which unlocks "In the dictionary". */
  firstAcceptance: boolean;
  onDismiss: () => void;
}

/** "“a”", "“a” and “b”", "“a”, “b” and “c”". */
function wordList(words: readonly string[]): string {
  const quoted = words.map((word) => `“${word}”`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * A thank-you over the puzzle when a word the player suggested has been
 * accepted into the dictionary (see game/suggestions.ts) -- a port of the
 * website's SuggestionAcceptedNotice. Stays until it is closed, so it is not
 * missed by a player who looked away as the app opened.
 *
 * In the flow, like the welcome back, so it pushes the puzzle down rather than
 * covering the drop.
 */
export function SuggestionAcceptedNotice({ words, firstAcceptance, onDismiss }: Props) {
  if (words.length === 0) return null;
  return <Notice words={words} firstAcceptance={firstAcceptance} onDismiss={onDismiss} />;
}

function Notice({ words, firstAcceptance, onDismiss }: Props) {
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

  const several = words.length > 1;
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
      <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
        🎉
      </Text>
      <View style={styles.copy}>
        <Text style={[styles.line, { color: theme.fg }]}>
          {several ? 'Your suggested words ' : 'Your suggested word '}
          <Text style={styles.strong}>{wordList(words)}</Text> {several ? 'were' : 'was'} added to the
          dictionary so everybody can play {several ? 'them' : 'it'} now! Thank you for helping grow the
          dictionary!
        </Text>
        {firstAcceptance && (
          <Text style={[styles.line, styles.achievement, { color: theme.fg }]}>
            Achievement unlocked: 📖 In the dictionary.
          </Text>
        )}
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
    marginBottom: 14.4,
    paddingVertical: 11.2,
    paddingHorizontal: 13.6,
    borderWidth: 1,
    borderRadius: 10.4,
  },
  icon: {
    fontSize: 17.6,
    lineHeight: 22,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  line: {
    fontSize: 14.72,
    lineHeight: 20.6,
  },
  strong: {
    fontWeight: '700',
  },
  achievement: {
    fontWeight: '600',
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

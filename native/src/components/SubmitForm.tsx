import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Feedback } from '../../../src/hooks/useDailyPuzzle';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  drop: string;
  disabled: boolean;
  feedback: Feedback | null;
  /** A live lookup is running and the player is waiting on it. */
  checking?: boolean;
  onSubmit: (word: string) => void;
}

/** Where a guess is typed. */
export function SubmitForm({ drop, disabled, feedback, checking = false, onSubmit }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const inputRef = useRef<TextInput>(null);

  /*
   * The Wordle shake on a rejection.
   *
   * Keyed off `feedback.key` rather than the feedback object, because the
   * interesting case is rejecting the *same* word twice: the message is
   * identical, and only the counter says a second verdict arrived. The website
   * solves this by forcing a reflow to restart a CSS animation; here the
   * animation is simply started again, which is the same idea with less
   * ceremony.
   */
  const [shake] = useState(() => new Animated.Value(0));
  const rejectionKey = feedback?.kind === 'rejected' ? feedback.key : null;

  useEffect(() => {
    if (rejectionKey === null) return;
    shake.setValue(0);
    Animated.sequence(
      [8, -8, 6, -6, 0].map((to) =>
        Animated.timing(shake, {
          toValue: to,
          duration: 55,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [rejectionKey, shake]);

  /*
   * The border breathes while a live lookup runs.
   *
   * An unexplained pause is what reads as broken; a stated one reads as work
   * being done, which is what buys the lookup its few seconds. The loop is
   * stopped rather than left to finish its breath -- the website holds the
   * pulse to the end of a cycle because a CSS animation snapping back mid-lift
   * is visible, but an interpolated value can simply be animated home.
   */
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!checking) {
      Animated.timing(pulse, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [checking, pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.border, theme.focusRing],
  });

  const trimmed = value.trim();

  function submit() {
    if (!trimmed || disabled) return;
    onSubmit(value);
    setValue('');
    // Tapping the on-screen button should not dismiss the keyboard -- the
    // player's next guess is the next thing they want to type.
    inputRef.current?.focus();
  }

  return (
    <View style={styles.form}>
      <Text style={[styles.label, { color: theme.fgMuted }]}>
        {disabled
          ? "You've completed this puzzle"
          : `Enter a word containing "${drop.toUpperCase()}"`}
      </Text>

      <Animated.View style={{ transform: [{ translateX: shake }] }}>
        <View style={styles.row}>
          <Animated.View style={[styles.field, { borderColor, backgroundColor: theme.cardBg }]}>
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={setValue}
              editable={!disabled}
              placeholder={disabled ? '' : 'type a word…'}
              placeholderTextColor={theme.fgFaint}
              style={[styles.input, { color: theme.fg }]}
              // Every one of these is off for the same reason: the game is
              // about finding a word the player already knows, and a keyboard
              // that capitalises, corrects or predicts would be playing it for
              // them -- or, worse, silently replacing a rare word with a common
              // one between the typing and the submitting.
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              maxLength={30}
              returnKeyType="go"
              // The keyboard's own "go" submits, and stays up for the next guess.
              blurOnSubmit={false}
              onSubmitEditing={submit}
              accessibilityLabel={`Enter a word containing ${drop.toUpperCase()}`}
            />
          </Animated.View>

          <Pressable
            onPress={submit}
            disabled={disabled || !trimmed}
            accessibilityRole="button"
            accessibilityLabel="Submit word"
            accessibilityState={{ disabled: disabled || !trimmed }}
            style={({ pressed }) => [
              styles.submit,
              {
                backgroundColor: theme.accent,
                opacity: disabled || !trimmed ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.submitText, { color: theme.accentFg }]}>Submit</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: space.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  field: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  input: {
    paddingHorizontal: space.md,
    // Tall enough to be a comfortable target and to leave the text room to
    // breathe; the platforms disagree about intrinsic input height, so it is
    // set rather than inherited.
    height: 48,
    fontSize: 17,
  },
  submit: {
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  submitText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

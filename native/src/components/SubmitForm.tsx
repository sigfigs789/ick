import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AcceptedWord, SubmissionResult } from '../../../src/game/types';
import type { Feedback } from '../../../src/hooks/useDailyPuzzle';
import { useIdleHint } from '../hooks/useIdleHint';
import type { Theme } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  drop: string;
  disabled: boolean;
  feedback: Feedback | null;
  /** A live lookup is running and the player is waiting on it. */
  checking?: boolean;
  /**
   * The word data the verdict needs is still downloading. Typing and the
   * button stay as they are; only a press that lands before the data shows a
   * spinner, then sends the word once it is in, as on the website.
   */
  loading?: boolean;
  /**
   * Answers with the verdict when it has one: a rejected word stays in the box
   * (see `send`), so anything that can reject must say so.
   */
  onSubmit: (word: string) => void | SubmissionResult | Promise<SubmissionResult | void>;
  /**
   * The puzzle being played and the words banked on it. Passing both is what
   * turns on the idle hint (see hooks/useIdleHint.ts).
   */
  date?: string;
  acceptedWords?: readonly AcceptedWord[];
  /**
   * Whether a sheet is up over the screen, which pauses the idle hint. The
   * website looks for one in the document; here the screen says.
   */
  covered?: boolean;
  /**
   * The button's word. The play screen says "Play": a guess is a move in the
   * game, not a form being sent.
   */
  submitLabel?: string;
}

/** One breath of the checking pulse, matching the website's input-checking-pulse. */
const PULSE_MS = 1200;

/** `hex` moved `amount` of the way towards `toward`, both #rrggbb. */
function mix(hex: string, toward: string, amount: number): string {
  const channel = (value: string, at: number) => parseInt(value.slice(at, at + 2), 16);
  const out = [1, 3, 5].map((at) =>
    Math.round(channel(hex, at) + (channel(toward, at) - channel(hex, at)) * amount)
      .toString(16)
      .padStart(2, '0')
  );
  return `#${out.join('')}`;
}

/**
 * The border lit by the pulse: the resting colour deepened towards black on a
 * light screen and towards white on a dark one (the website's --lift), so the
 * pulse deepens what is already there instead of introducing a colour.
 */
function litBorder(theme: Theme): string {
  return mix(theme.borderStrong, theme.dark ? '#ffffff' : '#000000', 0.45);
}

/** Where a guess is typed. */
export function SubmitForm({
  drop,
  disabled,
  feedback,
  checking = false,
  loading = false,
  onSubmit,
  date,
  acceptedWords,
  covered = false,
  submitLabel = 'Submit',
}: Props) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const idlePlaceholder = useIdleHint({ drop, date, acceptedWords, value, disabled, covered });
  const inputRef = useRef<TextInput>(null);
  // Play was pressed before the word data arrived: the button spins until it
  // does, then sends whatever is in the box.
  const [queued, setQueued] = useState(false);
  const waiting = queued && loading;

  /*
   * The Wordle shake on a rejection.
   *
   * Keyed off `feedback.key` rather than the feedback object, because the
   * interesting case is rejecting the *same* word twice: the message is
   * identical, and only the counter says a second verdict arrived. The website
   * forces a reflow to restart a CSS animation; here the animation is simply
   * started again. Its keyframes, over 0.35s.
   */
  const [shake] = useState(() => new Animated.Value(0));
  const rejectionKey = feedback?.kind === 'rejected' ? feedback.key : null;

  useEffect(() => {
    if (rejectionKey === null) return;
    shake.setValue(0);
    const frames = [-1, 3, -6, 6, -6, 6, -6, 3, -1, 0];
    Animated.sequence(
      frames.map((to) =>
        Animated.timing(shake, {
          toValue: to,
          duration: 35,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      )
    ).start();
  }, [rejectionKey, shake]);

  /*
   * The border breathes while a live lookup runs: up to the lit colour 18% of
   * the way through a 1.2s breath, and back down for the rest.
   *
   * An unexplained pause is what reads as broken; a stated one reads as work
   * being done. The website runs the pulse to the end of the breath it is in
   * before it stops, because a CSS animation snapping back mid-lift is visible;
   * an interpolated value can simply be animated home instead.
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
          duration: PULSE_MS * 0.18,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS * 0.82,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [checking, pulse]);

  // Focus colours the border the website's focus ring blue, except while a
  // lookup pulses it: that is a signal of its own and needs the border.
  const resting = focused ? theme.focusRing : theme.borderStrong;
  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [checking ? theme.borderStrong : resting, litBorder(theme)],
  });

  const trimmed = value.trim();
  const empty = !trimmed;
  // The website's disabled button, which an empty box and a press waiting on
  // the word data both are.
  const outlined = empty || disabled || waiting;

  async function send(submitted: string) {
    const result = await onSubmit(submitted);
    // A rejected word stays in the box. A near miss is usually a letter away
    // from an accepted one, and retyping it from scratch is the player's
    // punishment for having been close.
    if (result && !result.ok) return;
    // A live lookup can answer long after the player moved on, so only clear
    // the box if what is in it is still the word that was submitted.
    setValue((current) => (current === submitted ? '' : current));
  }

  function submit() {
    if (!trimmed || disabled || waiting) return;
    // Tapping the on-screen button should not dismiss the keyboard -- the
    // player's next guess is the next thing they want to type.
    inputRef.current?.focus();
    if (loading) {
      setQueued(true);
      return;
    }
    void send(value);
  }

  // The queued press goes through once the data is in. A box emptied while it
  // waited has nothing to send, so the press is dropped.
  useEffect(() => {
    if (!queued || loading) return;
    // `value` is read as it stands now; the send itself goes out on the next
    // tick, with the spinner cleared alongside it.
    const word = value;
    void Promise.resolve().then(() => {
      setQueued(false);
      if (word.trim() && !disabled) void send(word);
    });
    // Only the data arriving sends it; `value` is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, loading]);

  return (
    <View style={styles.form}>
      <Text style={[styles.label, { color: theme.fgMuted }]}>
        {disabled
          ? "You've completed this puzzle"
          : `Enter a word containing "${drop.toUpperCase()}"`}
      </Text>

      <Animated.View style={[styles.row, { transform: [{ translateX: shake }] }]}>
        <Animated.View style={[styles.field, { borderColor, backgroundColor: theme.cardBg }]}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!disabled}
            placeholder={disabled ? '' : (idlePlaceholder ?? 'type a word…')}
            placeholderTextColor={theme.fgFaint}
            style={[styles.input, { color: theme.fg }, value === '' && styles.inputPlaceholder]}
            // Every one of these is off for the same reason: the game is about
            // finding a word the player already knows, and a keyboard that
            // capitalises, corrects or predicts would be playing it for them --
            // or, worse, silently replacing a rare word with a common one
            // between the typing and the submitting.
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            returnKeyType="go"
            // The keyboard's own "go" submits, and stays up for the next guess.
            submitBehavior="submit"
            onSubmitEditing={submit}
            accessibilityLabel={`Enter a word containing ${drop.toUpperCase()}`}
          />
        </Animated.View>

        <Pressable
          onPress={submit}
          disabled={disabled || waiting || empty}
          accessibilityRole="button"
          accessibilityLabel={waiting ? 'Loading the word list' : submitLabel}
          accessibilityState={{ disabled: disabled || waiting || empty, busy: waiting }}
          style={({ pressed }) => [
            styles.submit,
            // An empty box means "type something", not "finished": an outline,
            // so it does not read as the dead grey of a disabled control.
            outlined
              ? { backgroundColor: 'transparent', borderColor: theme.borderStrong }
              : {
                  backgroundColor: theme.accent,
                  borderColor: theme.accent,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
          ]}
        >
          {waiting && <ActivityIndicator size="small" color={theme.fgFaint} />}
          <Text style={[styles.submitText, { color: outlined ? theme.fgFaint : theme.accentFg }]}>
            {submitLabel}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* .play .submit-form: right under the drop, 0.25rem under it. */
  form: {
    marginBottom: 4,
  },
  label: {
    marginBottom: 8,
    fontSize: 14.7,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  field: {
    flex: 1,
    minWidth: 0,
    borderWidth: 2,
    borderRadius: 10.4,
  },
  input: {
    paddingHorizontal: 14.4,
    // The website's 0.7rem padding round an 18.4px line; the platforms disagree
    // about intrinsic input height, so it is set rather than inherited.
    height: 46,
    fontSize: 18.4,
    fontWeight: '600',
  },
  // The placeholder in the body weight, as the website sets it.
  inputPlaceholder: {
    fontWeight: '400',
  },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 45.6,
    paddingHorizontal: 19.2,
    borderRadius: 10.4,
    borderWidth: 2,
  },
  submitText: {
    fontSize: 15.2,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

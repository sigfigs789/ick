import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACHIEVEMENTS } from '../../../src/game/achievements';
import { recordSuggestion } from '../../../src/game/suggestions';
import { sendFeedback, sendWordSuggestion } from '../host/submissions';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AchievementCelebration } from './AchievementCelebration';
import { Sheet } from './Sheet';

/** What the review queue accepts as a word (see the suggested_words migration). */
const SUGGESTION_RE = /^[a-z]{2,30}$/;

/** The badge a first suggestion earns, celebrated with the achievement card. */
export const WORD_SCOUT = ACHIEVEMENTS.find((achievement) => achievement.id === 'word-suggested');

/** The sheets the header's "?" menu opens besides How to play. */
export type MenuSheetKind = 'feedback' | 'suggest-word';

const TITLES: Record<MenuSheetKind, string> = {
  feedback: 'Feedback',
  'suggest-word': 'Suggest a word',
};

/**
 * A small sheet for one thing a player sends us: a note, or a word the game is
 * missing -- the website's MenuSheetModal. Each used to sit at the foot of
 * another sheet (How to play, Word rules); the "?" menu gives them a door of
 * their own, so this holds the box and nothing else, and opens with it focused,
 * since typing is the only thing to do here.
 *
 * Without the website's "beta" chip on the Feedback title, for the same reason
 * the header has none (see App.tsx): App Store Review Guideline 2.2.
 */
export function MenuSheet({ sheet, onClose }: { sheet: MenuSheetKind | null; onClose: () => void }) {
  // The last sheet asked for, kept while this one slides away so its title and
  // box do not vanish mid-animation.
  const [shown, setShown] = useState<MenuSheetKind>('feedback');
  if (sheet && sheet !== shown) setShown(sheet);
  // Word scout gets the same card a word's badge does, over the sheet.
  const [scouted, setScouted] = useState(false);
  const endScouted = useCallback(() => setScouted(false), []);

  return (
    <Sheet
      open={sheet !== null}
      title={TITLES[shown]}
      onClose={onClose}
      compact
      overlay={
        scouted &&
        WORD_SCOUT && <AchievementCelebration achievements={[WORD_SCOUT]} onDone={endScouted} />
      }
    >
      {/* Keyed so a fresh opening starts with an empty box and no thanks. */}
      {shown === 'feedback' ? (
        <FeedbackForm key={`feedback-${sheet !== null}`} />
      ) : (
        <SuggestionForm key={`suggest-${sheet !== null}`} onWordScout={() => setScouted(true)} />
      )}
      <KeyboardSpacer />
    </Sheet>
  );
}

/**
 * Room under the box for the keyboard it opens.
 *
 * The sheet hangs from the bottom of the screen, which is exactly where the
 * keyboard comes up, and on iOS a modal does not move out of its way -- so a
 * sheet that focuses its box on opening would be covering its own box. Growing
 * by the keyboard's height lifts the box clear of it. Android resizes the
 * window for the keyboard on its own, so there this stays empty.
 */
function KeyboardSpacer() {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // The sheet already pads itself by the home indicator's inset, which the
  // keyboard covers too.
  return <View style={{ height: Math.max(0, height - insets.bottom) }} />;
}

function FeedbackForm() {
  const theme = useTheme();
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  function submit() {
    const trimmed = note.trim();
    if (!trimmed) return;
    sendFeedback(trimmed);
    setNote('');
    setSent(true);
  }

  return (
    <View style={styles.form}>
      <View style={styles.row}>
        <TextInput
          value={note}
          onChangeText={(text) => {
            setNote(text);
            setSent(false);
          }}
          placeholder="Share feedback"
          placeholderTextColor={theme.fgFaint}
          autoFocus
          multiline
          numberOfLines={3}
          style={[
            styles.input,
            styles.multiline,
            { color: theme.fg, borderColor: theme.border, backgroundColor: theme.cardBg },
          ]}
          accessibilityLabel="Share feedback or leave a suggestion"
        />
        <SendButton label="Send" disabled={!note.trim()} onPress={submit} />
      </View>
      {/* Announced as well as seen: the box empties either way, and an empty
          box is not an answer. */}
      {sent && <Thanks text="Thanks for the feedback!" />}
    </View>
  );
}

function SuggestionForm({ onWordScout }: { onWordScout: () => void }) {
  const theme = useTheme();
  const [suggestion, setSuggestion] = useState('');
  const [sent, setSent] = useState(false);

  function submit() {
    const word = suggestion.trim().toLowerCase();
    if (!word) return;
    sendWordSuggestion(word);
    // Kept on the device for the Word scout badge and the accepted-word
    // thank-you (see game/suggestions.ts). Only a word the queue would take:
    // anything else never comes back with a verdict. The first earns Word
    // scout, announced with the achievement card: the website names it in the
    // thank-you only for the hidden arm of its header celebrations test, and
    // this build always takes the shown arm.
    if (SUGGESTION_RE.test(word) && recordSuggestion(word)) onWordScout();
    setSuggestion('');
    setSent(true);
  }

  return (
    <View style={styles.form}>
      <Text style={[styles.copy, { color: theme.fg }]}>
        Know a good word that's missing? Suggest it and everybody gets to play it.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={suggestion}
          onChangeText={(text) => {
            setSuggestion(text);
            setSent(false);
          }}
          placeholder="Enter a word"
          placeholderTextColor={theme.fgFaint}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={80}
          returnKeyType="send"
          onSubmitEditing={submit}
          style={[
            styles.input,
            { color: theme.fg, borderColor: theme.border, backgroundColor: theme.cardBg },
          ]}
          accessibilityLabel="Suggest a word"
        />
        <SendButton label="Suggest word" disabled={!suggestion.trim()} onPress={submit} />
      </View>
      {/* The website also links the queue, which this build has no page for. */}
      {sent && (
        <Thanks text="Thanks for the suggestion! We'll let you know if it gets in." />
      )}
    </View>
  );
}

function SendButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.send,
        { backgroundColor: theme.accent, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.sendText, { color: theme.accentFg }]}>{label}</Text>
    </Pressable>
  );
}

function Thanks({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text style={[styles.thanks, { color: theme.successFg }]} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  copy: {
    fontSize: 15,
    lineHeight: 22,
  },
  form: {
    gap: space.md,
  },
  /* The box and its button on one row, the button at the box's top when the
     feedback box grows. */
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 44,
    fontSize: 15,
  },
  multiline: {
    height: undefined,
    minHeight: 72,
    paddingVertical: space.md,
    textAlignVertical: 'top',
  },
  send: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  sendText: {
    fontSize: 14,
    fontWeight: '700',
  },
  thanks: {
    fontSize: 13,
    fontWeight: '600',
  },
});

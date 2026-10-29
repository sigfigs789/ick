import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { usesFreeformRules } from '../../../src/game/dictionary';
import { modeIsChosen, type GameMode } from '../../../src/game/mode';
import { takesPlayerMessages } from '../../../src/game/playerMessages';
import { recordSuggestion } from '../../../src/game/suggestions';
import { useGameMode } from '../../../src/hooks/useGameMode';
import { sendWordSuggestion } from '../host/submissions';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AchievementCelebration } from './AchievementCelebration';
import { WORD_SCOUT } from './MenuSheet';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  /** The puzzle being played, whose rules the copy states. */
  date?: string;
  /** The rules it is played under; the stored mode when not given. */
  mode?: GameMode;
  onClose: () => void;
}

/**
 * What's allowed, one sentence per era and, from MODE_CHOICE_START, one per
 * mode: the website's WordRulesModal copy, word for word. The archive still
 * plays the trial week's rules and the ones before it, so they are still said.
 */
/** What the review queue accepts as a word (see the suggested_words migration). */
const SUGGESTION_RE = /^[a-z]{2,30}$/;

function rulesCopy(date: string | undefined, mode: GameMode): string {
  if (date !== undefined && modeIsChosen(date)) {
    return mode === 'freeform'
      ? 'In Freeform, proper nouns, abbreviations, and obsolete, archaic or dated words all count. Misspellings, offensive words, hyphenated words and words with punctuation are the only ones left out.'
      : "Proper nouns and abbreviations count. Misspellings, offensive words, obsolete, archaic or dated words, hyphenated words and words with punctuation aren't eligible for play.";
  }
  return usesFreeformRules(date)
    ? "It's freeform week, so proper nouns, abbreviations, and obsolete, archaic or dated words all count. Misspellings, offensive words, hyphenated words and words with punctuation are the only ones left out."
    : "To keep play consistent, proper nouns, abbreviations, misspellings, obsolete, archaic, or dated words, hyphenated words, and words with punctuation aren't eligible for play.";
}

/**
 * Why a word was turned away, and the way to argue about it.
 *
 * Reached from "More info" on any rejection, which is the moment a player
 * actually wants the rules -- and the moment they are most likely to have a
 * word worth adding, which is why the suggestion box lives here rather than
 * somewhere they would have to go looking for it.
 */
export function WordRulesSheet({ open, date, mode, onClose }: Props) {
  const theme = useTheme();
  const [storedMode] = useGameMode();
  const takesSuggestions = takesPlayerMessages();
  const [suggestion, setSuggestion] = useState('');
  const [sent, setSent] = useState(false);
  // Word scout gets the same card a word's badge does, over the sheet.
  const [scouted, setScouted] = useState(false);
  const endScouted = useCallback(() => setScouted(false), []);

  function submit() {
    const word = suggestion.trim().toLowerCase();
    if (!word) return;
    sendWordSuggestion(word);
    // Kept on the device for the suggesting achievement (see
    // game/suggestions.ts). Only a word the queue would take: anything else
    // never comes back with a verdict. The first earns Word scout, announced
    // with the achievement card (see MenuSheet's SuggestionForm).
    if (SUGGESTION_RE.test(word) && recordSuggestion(word)) setScouted(true);
    setSuggestion('');
    setSent(true);
  }

  return (
    <Sheet
      open={open}
      title="Word rules"
      onClose={onClose}
      overlay={
        scouted &&
        WORD_SCOUT && <AchievementCelebration achievements={[WORD_SCOUT]} onDone={endScouted} />
      }
    >
      <Text style={[styles.copy, { color: theme.fg }]}>
        {rulesCopy(date, mode ?? storedMode)}
        {takesSuggestions &&
          " Know a good word that's missing? Suggest it and everybody gets to play it."}
      </Text>

      {takesSuggestions && (
        <View style={styles.form}>
          <Text style={[styles.label, { color: theme.fg }]}>Suggest a word</Text>
          <View style={styles.row}>
            <TextInput
              value={suggestion}
              onChangeText={(text) => {
                setSuggestion(text);
                setSent(false);
              }}
              placeholder="Enter a word"
              placeholderTextColor={theme.fgFaint}
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
            <Pressable
              onPress={submit}
              disabled={!suggestion.trim()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.send,
                {
                  backgroundColor: theme.accent,
                  opacity: !suggestion.trim() ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.sendText, { color: theme.accentFg }]}>Suggest word</Text>
            </Pressable>
          </View>
          {sent && (
            <Text
              style={[styles.thanks, { color: theme.successFg }]}
              accessibilityLiveRegion="polite"
            >
              Thanks for the suggestion! We'll let you know if it gets in.
            </Text>
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  copy: {
    fontSize: 15,
    lineHeight: 22,
  },
  form: {
    gap: space.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
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
  send: {
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

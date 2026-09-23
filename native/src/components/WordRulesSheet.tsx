import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { sendWordSuggestion } from '../host/submissions';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Why a word was turned away, and the way to argue about it.
 *
 * Reached from "More info" on any rejection, which is the moment a player
 * actually wants the rules -- and the moment they are most likely to have a
 * word worth adding, which is why the suggestion box lives here rather than
 * somewhere they would have to go looking for it.
 */
export function WordRulesSheet({ open, onClose }: Props) {
  const theme = useTheme();
  const [suggestion, setSuggestion] = useState('');
  const [sent, setSent] = useState(false);

  function submit() {
    const word = suggestion.trim().toLowerCase();
    if (!word) return;
    sendWordSuggestion(word);
    setSuggestion('');
    setSent(true);
  }

  return (
    <Sheet open={open} title="Word rules" onClose={onClose}>
      <Text style={[styles.copy, { color: theme.fg }]}>
        To keep play consistent, proper nouns, abbreviations, misspellings, obsolete, archaic,
        or dated words, hyphenated words, and words with punctuation aren't eligible for play.
        Know a good word that's missing? Suggest it and everybody gets to play it.
      </Text>

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
            <Text style={[styles.sendText, { color: theme.accentFg }]}>Suggest</Text>
          </Pressable>
        </View>
        {sent && (
          <Text
            style={[styles.thanks, { color: theme.successFg }]}
            accessibilityLiveRegion="polite"
          >
            Thanks for the suggestion!
          </Text>
        )}
      </View>
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

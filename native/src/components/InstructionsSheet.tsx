import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { sendFeedback } from '../host/submissions';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** How to play, and a box to write back through. */
export function InstructionsSheet({ open, onClose }: Props) {
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
    <Sheet open={open} title="How to play WordInk" onClose={onClose}>
      <Text style={[styles.copy, { color: theme.fg }]}>
        WordInk gives everyone the same daily drop — say, “INK”. Find the rarest English
        word you can that contains it, like th<Text style={styles.strong}>INK</Text>, wr
        <Text style={styles.strong}>INK</Text>le, or <Text style={styles.strong}>INK</Text>ling.
      </Text>

      <Text style={[styles.note, { color: theme.fgMuted, backgroundColor: theme.bgInset }]}>
        Rarity scores reflect how often a word appears across books, news, movies, websites,
        and social media — not how complex it is. Values are computed using Zipf's law. The
        highest ranks are Mythic at 9.5+ and Legend at 9.9+.
      </Text>

      <View style={styles.form}>
        <Text style={[styles.label, { color: theme.fg }]}>Share feedback</Text>
        <TextInput
          value={note}
          onChangeText={(text) => {
            setNote(text);
            setSent(false);
          }}
          placeholder="Share feedback"
          placeholderTextColor={theme.fgFaint}
          multiline
          numberOfLines={3}
          style={[
            styles.input,
            { color: theme.fg, borderColor: theme.border, backgroundColor: theme.cardBg },
          ]}
          accessibilityLabel="Share feedback or leave a suggestion"
        />
        <Pressable
          onPress={submit}
          disabled={!note.trim()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: theme.accent, opacity: !note.trim() ? 0.4 : pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.sendText, { color: theme.accentFg }]}>Send</Text>
        </Pressable>
        {/* Announced as well as seen: the box empties either way, and an empty
            box is not an answer. */}
        {sent && (
          <Text
            style={[styles.thanks, { color: theme.successFg }]}
            accessibilityLiveRegion="polite"
          >
            Thanks for the feedback!
          </Text>
        )}
      </View>

      <Text style={[styles.signoff, { color: theme.fgFaint }]}>
        Made by one person, for fun. Thanks for playing. 🙂
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  copy: {
    fontSize: 15,
    lineHeight: 22,
  },
  strong: {
    fontWeight: '800',
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    borderRadius: radius.sm,
    padding: space.md,
  },
  form: {
    gap: space.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 72,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  send: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
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
  signoff: {
    fontSize: 13,
    textAlign: 'center',
    paddingTop: space.sm,
  },
});

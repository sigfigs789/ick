import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { takesPlayerMessages } from '../../../src/game/playerMessages';
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
    <Sheet
      open={open}
      title={<>How to play Word<Text style={{ color: theme.rarity.Mythic.dot }}>Ink</Text></>}
      onClose={onClose}
    >
      <Text style={[styles.copy, { color: theme.fg }]}>
        <Text style={styles.strong}>Word<Text style={{ color: theme.rarity.Mythic.dot }}>Ink</Text></Text> gives everyone the same daily drop — say, “<Text style={[styles.strong, { color: theme.rarity.Mythic.dot }]}>INK</Text>”. Find the rarest English
        word you can that contains it, like th<Text style={[styles.strong, { color: theme.rarity.Mythic.dot }]}>INK</Text>, wr
        <Text style={[styles.strong, { color: theme.rarity.Mythic.dot }]}>INK</Text>le, or <Text style={[styles.strong, { color: theme.rarity.Mythic.dot }]}>INK</Text>ling.
      </Text>

      {/* No rarity-scores blurb any more, as on the website: How to play says
          what the game is, and the scores explain themselves on the board. */}
      {takesPlayerMessages() && (
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
              multiline
              numberOfLines={2}
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
          </View>
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
      )}

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
  form: {
    gap: space.sm,
  },
  /* The box and Send on one row, as the website's feedback form sets them. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 56,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  send: {
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

import { StyleSheet, Text } from 'react-native';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** How to play. */
export function InstructionsSheet({ open, onClose }: Props) {
  const theme = useTheme();

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
          what the game is, and the scores explain themselves on the board.

          No feedback box either: it has a sheet of its own now, behind the
          header's "?" menu (see MenuSheet.tsx). */}
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
  signoff: {
    fontSize: 13,
    textAlign: 'center',
    paddingTop: space.sm,
  },
});

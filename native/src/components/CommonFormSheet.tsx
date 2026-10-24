import { StyleSheet, Text, View } from 'react-native';
import { foldAffixGroups } from '../../../src/game/dictionary';
import type { GameMode } from '../../../src/game/mode';
import { font, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Sheet } from './Sheet';

interface Props {
  /** The word whose note was tapped, and the form it was scored as. Absent when closed. */
  word?: { word: string; base: string };
  /** The puzzle being played, which decides which affixes folded that day. */
  date?: string;
  /** The rules whose affixes to list; the stored mode's when not given. */
  mode?: GameMode;
  onClose: () => void;
}

/**
 * What "scored as its common form" means, behind the note's "More info".
 *
 * The phone half of the website's CommonFormModal, on the same argument: the
 * note names a form and stops, and the question a player asks next is what the
 * game thought their word was made of. Leads with their own pair, then the
 * affixes the fold reads through.
 *
 * `foldAffixGroups` supplies both, reading the date-scoped tables the scoring
 * itself reads -- so an archived August puzzle is explained with the longer
 * prefix list it was actually scored with, and a retired family leaves the
 * panel when it leaves the engine.
 */
export function CommonFormSheet({ word, date, mode, onClose }: Props) {
  const theme = useTheme();
  const groups = foldAffixGroups(date, mode);

  return (
    <Sheet open={word !== undefined} title="Common forms" onClose={onClose}>
      {word && (
        <>
          {/* The player's own word first: the panel was opened about one word,
              and the rule underneath it is the second thing they wanted. */}
          <View style={styles.pair}>
            <Text style={[styles.pairWord, { color: theme.fg }]}>{word.word}</Text>
            <Text style={[styles.arrow, { color: theme.fgMuted }]}>→</Text>
            <Text style={[styles.pairWord, { color: theme.fg }]}>{word.base}</Text>
          </View>
          {/* True in both directions: "abaci" folds up to "abacus" on the
              archived puzzles that still capped at a longer form. */}
          <Text style={[styles.copy, { color: theme.fg }]}>
            “{word.word}” scores as “{word.base}”, its more common form.
          </Text>

          {groups.map((group) => (
            <View key={group.title} style={[styles.group, { borderTopColor: theme.border }]}>
              <Text style={[styles.groupTitle, { color: theme.fg }]}>{group.title}</Text>
              <Text style={[styles.affixes, { color: theme.fg }]}>
                {group.affixes.join(', ')}
              </Text>
              <Text style={[styles.example, { color: theme.fgFaint }]}>
                {group.example.word} → {group.example.base}
              </Text>
            </View>
          ))}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pair: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  pairWord: {
    fontSize: 18,
    fontWeight: '700',
  },
  arrow: {
    fontSize: 15,
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
  },
  /* A rule per group rather than a card per group: ten cards is a stack to
     scroll past, where ten ruled rows is one thing to read. */
  group: {
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  /* Monospaced, so a hyphen reads as part of its affix rather than as
     punctuation between two of them. */
  affixes: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  example: {
    fontSize: 12,
  },
});

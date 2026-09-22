import { StyleSheet, Text, View } from 'react-native';
import { foldAffixGroups } from '../../../src/game/dictionary';
import { font, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Sheet } from './Sheet';

interface Props {
  /** The word whose note was tapped, and the form it was scored as. Absent when closed. */
  word?: { word: string; base: string };
  /** The puzzle being played, which decides which affixes folded that day. */
  date?: string;
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
export function CommonFormSheet({ word, date, onClose }: Props) {
  const theme = useTheme();
  const groups = foldAffixGroups(date);

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
          <Text style={[styles.copy, { color: theme.fg }]}>
            Scores come from how often a word gets used. “{word.word}” is “{word.base}”
            wearing an affix, so it scores as “{word.base}” — a familiar word in an
            unfamiliar shape isn't a rarer word.
          </Text>
          <Text style={[styles.copy, { color: theme.fg }]}>
            These are the affixes the scoring reads through. A word only moves if the form
            underneath is a real word and a more common one, so a score is only ever pulled
            toward the common form, never away from it.
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

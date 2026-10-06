import { StyleSheet, Text, View } from 'react-native';
import { formatRarityScore } from '../../../src/game/dictionary';
import type { Rarity } from '../../../src/game/types';
import { radius, space } from '../theme/tokens';
import { rarityPalette, useTheme } from '../theme/useTheme';

/**
 * The tier name is spelled out beside the colour, never instead of it.
 *
 * The same reasoning as the website's badge: a player reading in greyscale, or
 * one who cannot separate the purple from the blue, gets the identical
 * information a sighted player does. The dot reinforces the colour; it is not a
 * second channel carrying meaning of its own.
 */
const RARITY_TAG: Record<Rarity, string> = {
  Quotidian: 'QUOTIDIAN',
  'Very Common': 'VERY COMMON',
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Extremely Rare': 'EXTREMELY RARE',
  Elusive: 'ELUSIVE',
  Mythic: 'MYTHIC',
  Legend: 'LEGEND',
};

interface Props {
  rarity: Rarity;
  /** Measured Zipf frequency, shown as the rarity score the game plays on. */
  zipf?: number;
  /** The puzzle's date, so both the score and the palette match the day it was played. */
  date?: string;
}

export function RarityBadge({ rarity, zipf, date }: Props) {
  const theme = useTheme();
  const palette = rarityPalette(theme, rarity, date);

  return (
    <View
      style={[styles.badge, { backgroundColor: palette.bg }]}
      accessibilityRole="text"
      accessibilityLabel={
        zipf === undefined ? rarity : `${rarity}, score ${formatRarityScore(zipf, date)}`
      }
    >
      <View style={[styles.dot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.tag, { color: palette.fg }]}>{RARITY_TAG[rarity]}</Text>
      {zipf !== undefined && (
        <Text style={[styles.score, { color: palette.fg }]}>{formatRarityScore(zipf, date)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingVertical: 3,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  score: {
    fontSize: 11,
    fontWeight: '800',
    // Kept off the tag by a hair more than the gap, so the number reads as a
    // separate fact rather than the last word of the label.
    marginLeft: 2,
  },
});

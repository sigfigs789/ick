import { useColorScheme } from 'react-native';
import { usesRetunedTiers } from '../../../src/game/dictionary';
import type { Rarity } from '../../../src/game/types';
import { darkTheme, lightTheme, type RarityPalette, type Theme } from './tokens';

/**
 * The palette for whichever appearance the device is set to.
 *
 * Follows the system rather than offering a switch of its own, which is what
 * `color-scheme: light dark` does on the website. A daily game is opened for
 * three minutes; a setting the player has to find and maintain for those three
 * minutes is a setting they will not find.
 */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}

/**
 * A tier's colours under `date`'s puzzle.
 *
 * The date is not decoration. Legend wore orange before the tiers were retuned,
 * and archived puzzles still render from that frozen palette, so a badge drawn
 * without knowing which day it belongs to can silently restyle a result the
 * player already shared. The rule lives in `rarityStyles.ts` on the website;
 * this is the same rule, reading the same `usesRetunedTiers`.
 */
export function rarityPalette(theme: Theme, rarity: Rarity, date?: string): RarityPalette {
  if (rarity === 'Legend' && !usesRetunedTiers(date)) return theme.legendLegacy;
  return theme.rarity[rarity];
}

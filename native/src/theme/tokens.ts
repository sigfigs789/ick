import { Platform } from 'react-native';
import type { Rarity } from '../../../src/game/types';

/**
 * The website's palette, as values instead of custom properties.
 *
 * Ported from `src/index.css` rather than reinvented: the rarity ladder is the
 * game's one piece of visual vocabulary -- a player learns that purple is
 * Extremely Rare and black is Legend -- and a phone build that reshuffled the
 * hues would be teaching a second language for the same game. Both themes are
 * carried over whole, including the frozen orange that archived puzzles use for
 * Legend from before the tiers were retuned.
 *
 * Shadows are the one thing that does not survive the port: CSS shadow strings
 * have no React Native equivalent, and the two platforms disagree about how to
 * spell what is left (`shadow*` on iOS, `elevation` on Android). Cards get a
 * border and a raised surface colour instead, which is what carries the
 * separation on a small screen anyway.
 */

export interface RarityPalette {
  bg: string;
  fg: string;
  dot: string;
}

export interface Theme {
  dark: boolean;

  bg: string;
  bgInset: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  border: string;
  borderStrong: string;
  cardBg: string;

  accent: string;
  accentFg: string;

  dangerFg: string;
  dangerBg: string;
  cautionFg: string;
  cautionBg: string;
  successFg: string;
  successBg: string;
  focusRing: string;

  bestWordAccent: string;
  bestWordBg: string;
  /** The crowned word's card outline: orange, so it stands apart from a gold Elusive badge. */
  bestWordBorder: string;

  rarity: Record<Rarity, RarityPalette>;
  /** Legend as it was before the tiers were retuned; archived puzzles keep it. */
  legendLegacy: RarityPalette;
  /** Elusive's burnt amber before GOLD_ELUSIVE_START; archived puzzles keep it. */
  elusiveAmber: RarityPalette;
}

export const lightTheme: Theme = {
  dark: false,

  bg: '#fafafa',
  bgInset: '#f0f1f2',
  fg: '#1a1a1b',
  fgMuted: '#5d6066',
  fgFaint: '#8a8d93',
  border: '#d3d6da',
  borderStrong: '#b6b9bd',
  cardBg: '#ffffff',

  accent: '#1a1a1b',
  accentFg: '#ffffff',

  dangerFg: '#8c1d18',
  dangerBg: '#fbeae9',
  cautionFg: '#6b4a05',
  cautionBg: '#fdf3d4',
  successFg: '#14532d',
  successBg: '#e9f9ee',
  focusRing: '#2563eb',

  bestWordAccent: '#eab308',
  bestWordBg: '#fbf3d6',
  bestWordBorder: '#f97316',

  rarity: {
    Quotidian: { bg: '#000000', fg: '#ffffff', dot: '#ffffff' },
    'Very Common': { bg: '#eceef1', fg: '#4b4f57', dot: '#9aa0a8' },
    Common: { bg: '#ece1d4', fg: '#6b4423', dot: '#8b5a2b' },
    Uncommon: { bg: '#e3f6e8', fg: '#1c7a3d', dot: '#2fa457' },
    Rare: { bg: '#e2eefd', fg: '#1450b8', dot: '#2f78e0' },
    'Extremely Rare': { bg: '#f1e6fc', fg: '#7222c2', dot: '#9b4fe0' },
    Elusive: { bg: '#fdf3c4', fg: '#854d0e', dot: '#eab308' },
    Mythic: { bg: '#fdeae8', fg: '#b42318', dot: '#e5484d' },
    Legend: { bg: '#1b1b1f', fg: '#f7f7f9', dot: '#f7f7f9' },
  },
  legendLegacy: { bg: '#fde6d0', fg: '#9a4300', dot: '#ff8000' },
  elusiveAmber: { bg: '#fbe6da', fg: '#7c2d12', dot: '#c2410c' },
};

export const darkTheme: Theme = {
  dark: true,

  bg: '#121213',
  bgInset: '#1c1c1e',
  fg: '#f4f4f5',
  fgMuted: '#a7aab0',
  fgFaint: '#75787e',
  border: '#3a3a3c',
  borderStrong: '#4d4f52',
  cardBg: '#19191b',

  accent: '#f4f4f5',
  accentFg: '#121213',

  dangerFg: '#ffb4ac',
  dangerBg: '#3a1a1a',
  cautionFg: '#f5d98a',
  cautionBg: '#3a2f10',
  successFg: '#9fe0b6',
  successBg: '#10301c',
  focusRing: '#6d9bff',

  bestWordAccent: '#facc15',
  bestWordBg: '#2e2607',
  bestWordBorder: '#fb923c',

  rarity: {
    Quotidian: { bg: '#000000', fg: '#ffffff', dot: '#ffffff' },
    'Very Common': { bg: '#232326', fg: '#c2c5cb', dot: '#8a8d93' },
    Common: { bg: '#291c10', fg: '#d8b98f', dot: '#a9784b' },
    Uncommon: { bg: '#0f2b19', fg: '#7fe0a3', dot: '#3bbf6c' },
    Rare: { bg: '#0f2140', fg: '#8bb6fb', dot: '#4a8ff2' },
    'Extremely Rare': { bg: '#2a1440', fg: '#cd9bf7', dot: '#ab5ff0' },
    Elusive: { bg: '#2b2205', fg: '#fcd34d', dot: '#facc15' },
    Mythic: { bg: '#3a1414', fg: '#f7a19a', dot: '#e5484d' },
    Legend: { bg: '#000000', fg: '#f7f7f9', dot: '#ffffff' },
  },
  legendLegacy: { bg: '#2e1a08', fg: '#fdba74', dot: '#ff8000' },
  elusiveAmber: { bg: '#2b1409', fg: '#f4a97c', dot: '#ea580c' },
};

/** The spacing step everything is laid out on, so a screen is not a pile of magic numbers. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

/**
 * The one typeface decision.
 *
 * The website sets Libre Franklin and Karla, which on a phone would mean
 * bundling four font files and a loading state before the first paint. The
 * system face is the better trade here: it is already on the device, it matches
 * what the player reads in every other app, and it carries the dynamic-type
 * settings a system font is expected to respect.
 *
 * The drop tiles are the exception -- see `mono`. Letters in a row of fixed
 * boxes have to be a fixed width or the boxes visibly disagree with each other.
 */
export const font = {
  /** The two platforms spell their built-in monospace differently. */
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

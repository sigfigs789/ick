import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameMode } from '../../../src/game/mode';
import { loadPlayerId, selfName } from '../../../src/game/player';
import { loadReveal, saveReveal } from '../../../src/game/reveal';
import { buildShareText, type RevealMode } from '../../../src/game/share';
import type { FlameTier } from '../../../src/game/shareFlames';
import { loadShowName, saveShowName } from '../../../src/game/shareName';
import type { AcceptedWord, StreakState } from '../../../src/game/types';
import { signalTap } from '../host/feedback';
import { shareText as openShareSheet } from '../host/share';
import { font } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ShareFlames, shareFlamesStyle } from './ShareFlames';

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  /** Whether this is the current puzzle, which is what lets the result say "Today". */
  isToday?: boolean;
  /**
   * The rules this puzzle was played under, named on the share (see
   * src/game/share.ts). From the progress record rather than any switch, so
   * an archived day shares the mode it was played in.
   */
  mode?: GameMode;
  /**
   * The play screen's layout: the preview of what Share sends first, the
   * answer and username choices folded behind a "Share options" toggle under
   * it, and Share itself at the bottom. Most players share with the choices
   * they already have, so the choices stay out of the way until asked for.
   */
  collapsible?: boolean;
  /**
   * Bumped each time the player asks for this panel from elsewhere (the Share
   * beside the guess count), which scrolls it into view. 0 never scrolls, so
   * a panel that is simply on the screen when it loads stays where it is.
   */
  scrollSignal?: number;
  /**
   * How a scroll into view happens: the screen's ScrollView, scrolled to `y`.
   * `y` is the panel's top in its parent, so the panel must sit directly in
   * the ScrollView's content for it to be the content offset. The website
   * stops 1rem clear of the top edge; that margin is already taken off.
   */
  onScrollTo?: (y: number) => void;
  /** The tier the Share button burns in, or none (see src/game/shareFlames.ts). */
  flames?: FlameTier | null;
  /** Called after the result has been shared. */
  onShared?: () => void;
}

// Naming answers is opt-in so a shared result stays spoiler-free by default;
// the player can reveal just their rarest word ("Top") or every word ("All").
const REVEAL_OPTIONS: { value: RevealMode; label: string }[] = [
  { value: 'none', label: 'Hide' },
  { value: 'top', label: 'Top' },
  { value: 'all', label: 'All' },
];

/** The website's scroll-margin-top on the panel. */
const SCROLL_MARGIN = 16;

/**
 * The shareable result, available from the first banked word.
 *
 * Not from the end of the puzzle: sharing used to be the reward for declaring
 * the day over, so a player sitting on the best word they would find all week
 * had to close the puzzle irreversibly to post it -- and nothing was ever at
 * stake in the declaration, because the streak, the counters and the board all
 * bank on the word itself.
 *
 * One share button rather than the website's two. A phone has a real share
 * sheet, which already lists every destination the player has, chosen by them
 * (see src/host/share.ts).
 */
export function ResultsPanel({
  date,
  drop,
  words,
  streak,
  isToday = false,
  mode,
  collapsible = false,
  scrollSignal = 0,
  onScrollTo,
  flames = null,
  onShared,
}: Props) {
  const theme = useTheme();
  const fire = flames ? shareFlamesStyle(theme, flames) : null;

  // Starts from the player's last choice, "Top" until they make one (see
  // src/game/reveal.ts).
  const [reveal, setRevealState] = useState<RevealMode>(loadReveal);
  const setReveal = (next: RevealMode) => {
    setRevealState(next);
    saveReveal(next);
  };
  const [shared, setShared] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // On until the player switches it off, and remembered once they do (see
  // src/game/shareName.ts).
  const [showName, setShowNameState] = useState<boolean>(loadShowName);
  const setShowName = (next: boolean) => {
    setShowNameState(next);
    saveShowName(next);
  };
  // The name the board calls this player, so the share and their row agree.
  const playerId = loadPlayerId();
  const playerName = playerId ? selfName(playerId) : null;

  const options = {
    reveal,
    streak: streak.currentStreak,
    playerName: showName ? playerName : null,
    isToday,
    mode,
  };
  const preview = buildShareText(date, drop, words, options);
  // What actually leaves the app carries the attribution code the website's
  // copied result does, so an arrival from a shared phone result is
  // distinguishable from one typed in.
  const outgoing = buildShareText(date, drop, words, { ...options, source: 'share' });
  const [heading, ...detail] = preview.split('\n');

  /*
   * Into view when asked for. The ask and the panel's first layout can come in
   * either order -- the press that bumps the signal is also what mounts the
   * panel -- so the request waits for a measured position.
   */
  const top = useRef<number | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (scrollSignal === 0) return;
    if (top.current === null) {
      pending.current = true;
      return;
    }
    onScrollTo?.(Math.max(0, top.current - SCROLL_MARGIN));
    // Only a new ask scrolls; a moved callback is not one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollSignal]);

  // share-panel-in on the play screen (rising 16pt), panel-in otherwise (8pt).
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: collapsible ? 450 : 400,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [enter, collapsible]);
  const rise = collapsible ? 16 : 8;

  async function share() {
    signalTap();
    const done = await openShareSheet(outgoing);
    if (!done) return;
    setShared(true);
    onShared?.();
    setTimeout(() => setShared(false), 2000);
  }

  const shareButton = (
    <Pressable
      onPress={share}
      accessibilityRole="button"
      accessibilityLabel="Share your result"
      style={({ pressed }) => [
        styles.share,
        collapsible && styles.shareWide,
        { backgroundColor: theme.accent, transform: [{ scale: pressed ? 0.97 : 1 }] },
        fire?.button,
      ]}
    >
      {flames && <ShareFlames tier={flames} />}
      <Text style={[styles.shareText, { color: theme.accentFg }, fire?.text]}>
        {shared ? 'Shared!' : 'Share'}
      </Text>
    </Pressable>
  );

  const previewBlock = (
    <Text
      style={[
        styles.preview,
        !collapsible && styles.previewSpaced,
        { color: theme.fgMuted, backgroundColor: theme.bgInset, borderColor: theme.border },
      ]}
      // A picture of the text the share sheet will carry; reading it aloud
      // line by line would announce the result twice.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.previewHeading}>{heading}</Text>
      {detail.length > 0 && `\n${detail.join('\n')}`}
    </Text>
  );

  const choices = (
    <>
      <View style={styles.choiceRow} accessibilityRole="radiogroup" accessibilityLabel="Show answers">
        <Text style={[styles.choiceText, { color: theme.fgMuted }]}>Show answers</Text>
        <View style={styles.choiceOptions}>
          {REVEAL_OPTIONS.map((option) => {
            const checked = option.value === reveal;
            return (
              <Pressable
                key={option.value}
                onPress={() => setReveal(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                accessibilityLabel={option.label}
                hitSlop={6}
                style={styles.choice}
              >
                <View
                  style={[
                    styles.radio,
                    { borderColor: checked ? theme.accent : theme.borderStrong },
                  ]}
                >
                  {checked && <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />}
                </View>
                <Text style={[styles.choiceText, { color: theme.fgMuted }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {playerName && (
        <Pressable
          onPress={() => setShowName(!showName)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: showName }}
          accessibilityLabel="Show username"
          hitSlop={6}
          style={[styles.choice, styles.nameToggle]}
        >
          <View
            style={[
              styles.checkbox,
              showName
                ? { backgroundColor: theme.accent, borderColor: theme.accent }
                : { borderColor: theme.borderStrong },
            ]}
          >
            {showName && <Text style={[styles.check, { color: theme.accentFg }]}>✓</Text>}
          </View>
          <Text style={[styles.choiceText, { color: theme.fgMuted }]}>Show username</Text>
        </Pressable>
      )}
    </>
  );

  return (
    <Animated.View
      onLayout={(event) => {
        top.current = event.nativeEvent.layout.y;
        if (pending.current) {
          pending.current = false;
          onScrollTo?.(Math.max(0, top.current - SCROLL_MARGIN));
        }
      }}
      style={[
        styles.panel,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.border,
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
          ],
        },
      ]}
      accessibilityLabel="Share result"
    >
      {collapsible ? (
        <>
          {previewBlock}
          <Pressable
            onPress={() => setOptionsOpen((was) => !was)}
            accessibilityRole="button"
            accessibilityState={{ expanded: optionsOpen }}
            hitSlop={6}
            style={styles.optionsToggle}
          >
            {({ pressed }) => (
              <Text style={[styles.optionsToggleText, { color: pressed ? theme.fg : theme.fgMuted }]}>
                Share options {optionsOpen ? '▴' : '▾'}
              </Text>
            )}
          </Pressable>
          {optionsOpen && <View style={styles.options}>{choices}</View>}
          <View style={styles.bottomActions}>{shareButton}</View>
        </>
      ) : (
        <>
          <View style={styles.actions}>{shareButton}</View>
          {choices}
          {previewBlock}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /* .results-panel */
  panel: {
    marginTop: 3.2,
    paddingVertical: 24,
    paddingHorizontal: 22.4,
    borderWidth: 1,
    borderRadius: 16,
  },
  /* .results-panel__preview: the share text as it will read, in a dashed
     inset. Monospace, as the website's <pre> is, so the squares line up. */
  preview: {
    padding: 13.6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 9.6,
    overflow: 'hidden',
    fontFamily: font.mono,
    fontSize: 13.6,
    lineHeight: 20,
  },
  previewSpaced: {
    marginTop: 8.8,
  },
  previewHeading: {
    fontWeight: '700',
  },
  optionsToggle: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  optionsToggleText: {
    fontSize: 13.6,
    fontWeight: '700',
  },
  options: {
    alignItems: 'flex-start',
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14.4,
    marginTop: 13.6,
    marginBottom: 6.8,
  },
  choiceOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14.4,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.6,
  },
  nameToggle: {
    marginBottom: 6.8,
  },
  choiceText: {
    fontSize: 13.6,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 13,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  bottomActions: {
    marginTop: 16,
  },
  /* .share-button */
  share: {
    minHeight: 45.6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11.2,
    paddingHorizontal: 19.2,
    borderRadius: 10.4,
  },
  shareWide: {
    alignSelf: 'stretch',
  },
  shareText: {
    fontSize: 15.2,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

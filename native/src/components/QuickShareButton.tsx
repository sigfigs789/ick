import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { GameMode } from '../../../src/game/mode';
import { loadPlayerId, selfName } from '../../../src/game/player';
import { loadReveal } from '../../../src/game/reveal';
import { buildShareText } from '../../../src/game/share';
import { loadShowName } from '../../../src/game/shareName';
import type { AcceptedWord, StreakState } from '../../../src/game/types';
import { signalTap } from '../host/feedback';
import { shareText } from '../host/share';
import { useTheme } from '../theme/useTheme';

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  isToday: boolean;
  mode?: GameMode;
  /** On the press: the play screen opens the share panel and scrolls to it. */
  onShared?: () => void;
}

/**
 * Share from the top of the guess log, on the play screen.
 *
 * The website's copies the result and opens the share panel below it. Here
 * the press raises the system share sheet instead (see src/host/share.ts),
 * and opens the panel at the same moment, so it is waiting under the sheet
 * with the choices behind what was shared.
 *
 * Shares exactly what the panel's own Share would: the text is built at the
 * moment of the press from the same saved choices the panel reads and writes
 * (answers shown, username on or off), so the two can never disagree.
 */
export function QuickShareButton({ date, drop, words, streak, isToday, mode, onShared }: Props) {
  const theme = useTheme();
  const [shared, setShared] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function share() {
    signalTap();
    const playerId = loadPlayerId();
    const playerName = playerId && loadShowName() ? selfName(playerId) : null;
    const text = buildShareText(date, drop, words, {
      reveal: loadReveal(),
      streak: streak.currentStreak,
      playerName,
      isToday,
      mode,
      source: 'share',
    });
    onShared?.();
    const done = await shareText(text);
    if (!done) return;
    setShared(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShared(false), 2000);
  }

  return (
    <Pressable
      onPress={() => void share()}
      accessibilityRole="button"
      accessibilityLabel={shared ? 'Shared' : 'Share your result'}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.text, { color: theme.accentFg }]}>{shared ? 'Shared!' : 'Share'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* .quick-share */
  button: {
    minHeight: 32,
    justifyContent: 'center',
    paddingVertical: 4.8,
    paddingHorizontal: 12.8,
    borderRadius: 8,
  },
  text: {
    fontSize: 13.1,
    fontWeight: '700',
  },
});

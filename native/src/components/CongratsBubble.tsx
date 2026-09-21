import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  congratsMessage,
  congratsPopped,
  congratsSpot,
  markCongratsPopped,
} from '../../../src/game/congrats';
import { fetchBoards } from '../../../src/game/leaderboard';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** How long the pop plays before the bubble leaves the screen. */
const POP_MS = 260;
/** One up-and-down of the bob, slow enough to read as floating. */
const BOB_MS = 1800;

/**
 * A bubble floating over the board, naming whoever won the window that just
 * closed, which pops when it is pressed.
 *
 * The same feature the website has, off the same rules (see
 * src/game/congrats.ts): the Tuesday after a week ends, the second of the month
 * after a month does, and nothing on any other day. Sharing that module is what
 * keeps the two front-ends congratulating the same player on the same day --
 * the phone deciding for itself which day a week ends on is exactly the kind of
 * second answer that drifts.
 *
 * The board itself says who is *leading* -- rank 1 wears the gold on every
 * window -- but a week that closed on Saturday is a step back by Tuesday, and
 * nobody steps back to a board they were not already on. This is the one place
 * a result gets said out loud.
 *
 * Pressing it is the whole interaction: the bubble is the button, and it is
 * remembered as popped so it is one appearance rather than something to dismiss
 * again after lunch. It asks for the closed window itself and answers nothing
 * if that fails -- the board underneath never waits on it.
 */
export function CongratsBubble({ today }: { today: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  /*
   * The window being congratulated, fixed for the life of the screen: `today`
   * is itself fixed when the screen mounts (see LeaderboardScreen), so an app
   * left open across midnight does not grow a bubble.
   */
  const spot = useMemo(() => congratsSpot(today), [today]);
  const [winner, setWinner] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  /*
   * Whether the phone has been asked to keep things still.
   *
   * Worth asking here and nowhere else in this app: everything else that moves
   * is a burst that ends by itself, while a bob runs for as long as the bubble
   * is on screen. Null until the answer comes back, which is why nothing starts
   * animating before it does.
   */
  const [stillness, setStillness] = useState<boolean | null>(null);
  const enter = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const [popping, setPopping] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (live) setStillness(reduced);
      })
      // A phone that will not answer is treated as one that never asked for
      // stillness, which is the same thing every other animation here assumes.
      .catch(() => {
        if (live) setStillness(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    // Nothing to say today, or this window's bubble has already been popped on
    // this device. Asked before the request, so a player who popped it this
    // morning costs the server nothing this afternoon.
    if (!spot || congratsPopped(spot)) return;
    let live = true;
    // The same endpoint the board comes from, asked for the window that closed
    // rather than the one being played.
    void (async () => {
      try {
        const boards = await fetchBoards(
          today,
          spot.window === 'week' ? { week: spot.start } : { month: spot.start },
        );
        if (!live) return;
        const board = spot.window === 'week' ? boards.weekly : boards.monthly;
        // A window nobody scored in has no winner to name.
        const champion = board.find((entry) => entry.rank === 1) ?? board[0];
        if (champion) setWinner(champion.name);
      } catch {
        // A congratulation that would not load is not worth telling anybody
        // about: the board under it is the screen.
      }
    })();
    return () => {
      live = false;
    };
  }, [spot, today]);

  /* Arrive, then float there. Both on the native driver, so neither costs a
     frame on the JS thread while somebody is scrolling the board behind it. */
  useEffect(() => {
    if (!winner || stillness === null) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: stillness ? 0 : 260,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
    if (stillness) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: BOB_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: BOB_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [winner, stillness, enter, bob]);

  if (!spot || !winner || gone) return null;

  function onPress() {
    if (!spot || popping) return;
    // Remembered on the press rather than when the animation ends, so leaving
    // the screen mid-pop has still popped it.
    markCongratsPopped(spot);
    setPopping(true);
    Animated.timing(pop, {
      toValue: 1,
      duration: stillness ? 0 : POP_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => setGone(true));
  }

  const message = congratsMessage(winner, spot);

  return (
    // `box-none` so the strip places the bubble without swallowing presses
    // meant for the board underneath it.
    <View
      style={[styles.strip, { bottom: insets.bottom + space.lg }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={{
          opacity: Animated.multiply(
            enter,
            pop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1, 0] }),
          ),
          transform: [
            {
              translateY: Animated.add(
                enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
                bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }),
              ),
            },
            {
              // One swell and then away, which is what popping looks like.
              scale: Animated.multiply(
                enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
                pop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.18, 0.6] }),
              ),
            },
          ],
        }}
      >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={message}
          accessibilityHint="Pops the bubble"
          style={[
            styles.bubble,
            { backgroundColor: theme.bestWordBg, borderColor: theme.bestWordAccent },
          ]}
        >
          <Text style={styles.emoji}>{'\u{1F389}'}</Text>
          <Text style={[styles.text, { color: theme.fg }]}>{message}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* Both edges rather than a centred point, so the bubble may use the width of
     the screen before its one sentence wraps. */
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  emoji: {
    fontSize: 16,
  },
  text: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
});

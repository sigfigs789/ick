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
import {
  congratsMessage,
  congratsPopped,
  congratsSpot,
  markCongratsPopped,
} from '../../../src/game/congrats';
import { fetchBoards } from '../../../src/game/leaderboard';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** How long the ink is on screen after a hit, before the blot is dropped. */
const SPLAT_MS = 900;
/** One leg of the wander: the bubble drifts to a new spot this often. */
const DRIFT_MS = 5200;

/**
 * Where the bubble wanders, as a share of the room it has.
 *
 * `x` is a share of the slack either side of the bubble and `y` a share of the
 * board's height, so the same five turns are the same walk on a small phone and
 * on a tablet -- and the bubble can never travel off the side of the screen,
 * because full deflection is exactly the edge of the space it fits in.
 *
 * A written path rather than random destinations: five turns is already
 * unpredictable to look at, and a path written down cannot wander somewhere it
 * should not be. Kept off dead centre for long, because the standings are what
 * the reader came for.
 */
const PATH = [
  { x: 0, y: 0.08 },
  { x: 0.72, y: 0.34 },
  { x: -0.18, y: 0.66 },
  { x: -0.76, y: 0.4 },
  { x: 0.34, y: 0.15 },
] as const;

/**
 * The spray thrown off the blot, as offsets in points from where it landed.
 *
 * Uneven on purpose -- an even fan reads as a clock face rather than as ink --
 * and each droplet has its own size, because ink does.
 */
const DROPS = [
  { x: -44, y: -26, size: 11 },
  { x: 32, y: -40, size: 7 },
  { x: 49, y: 13, size: 13 },
  { x: 17, y: 46, size: 8 },
  { x: -34, y: 37, size: 12 },
  { x: -52, y: 6, size: 6 },
  { x: 6, y: -52, size: 9 },
] as const;

/**
 * A bubble wandering over the board, naming whoever won the window that just
 * closed, which splats into an ink blot when it is hit.
 *
 * The same feature the website has, off the same rules (see
 * src/game/congrats.ts): the Tuesday after a week ends, the second of the month
 * after a month does, and nothing on any other day. Sharing that module is what
 * keeps the two front-ends congratulating the same player on the same day --
 * the phone deciding for itself when a week ends is exactly the kind of second
 * answer that drifts.
 *
 * The board itself says who is *leading* -- rank 1 wears the gold on every
 * window -- but a week that closed on Saturday is a step back by Tuesday, and
 * nobody steps back to a board they were not already on. This is the one place
 * a result gets said out loud.
 *
 * It moves, and that is the point: a notice pinned to the bottom of the screen
 * is furniture, and furniture is read once and then looked past. Something
 * drifting over the board is asking to be tapped -- and this game is called
 * WordInk, so what a tap leaves behind is ink. It asks for the closed window
 * itself and answers nothing if that fails; the board underneath never waits
 * on it.
 */
export function CongratsBubble({ today }: { today: string }) {
  const theme = useTheme();
  /*
   * The window being congratulated, fixed for the life of the screen: `today`
   * is itself fixed when the screen mounts (see LeaderboardScreen), so an app
   * left open across midnight does not grow a bubble.
   */
  const spot = useMemo(() => congratsSpot(today), [today]);
  const [winner, setWinner] = useState<string | null>(null);
  /** Hit: the bubble is gone and the ink is landing where it was. */
  const [splatting, setSplatting] = useState(false);
  /** Dropped, once the ink has soaked away. */
  const [gone, setGone] = useState(false);
  /*
   * Whether the phone has been asked to keep things still.
   *
   * Worth asking here and nowhere else in this app: everything else that moves
   * is a burst that ends by itself, while the wander runs for as long as the
   * bubble is on screen. Null until the answer comes back, which is why nothing
   * starts moving before it does.
   */
  const [stillness, setStillness] = useState<boolean | null>(null);
  const enter = useRef(new Animated.Value(0)).current;
  /** How far along the path the bubble is: leg `n` runs from n to n+1. */
  const leg = useRef(new Animated.Value(0)).current;
  const splat = useRef(new Animated.Value(0)).current;
  /** The size of the board, so the path can be a share of it rather than points. */
  const [area, setArea] = useState({ width: 0, height: 0 });
  /**
   * The size of the bubble itself, which is what the path has to keep inside
   * the board: a sentence is as long as the name in it, and a walk written in
   * fixed points would take a long handle off the side of a phone.
   */
  const [bubble, setBubble] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (live) setStillness(reduced);
      })
      // A phone that will not answer is treated as one that never asked for
      // stillness, which is what every other animation here assumes.
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

  /* Arrive, then wander. Both on the native driver, so neither costs a frame on
     the JS thread while somebody is scrolling the board behind it. */
  useEffect(() => {
    if (!winner || stillness === null) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: stillness ? 0 : 260,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
    // Stillness keeps the bubble at the first point on the path, which is where
    // it arrives -- readable, tappable, and not going anywhere.
    if (stillness) return;
    // One leg per hop, and one hop more than there are stops: the path ends
    // where it started (see `stops`), so a repeat picks up where the last pass
    // left off instead of snapping across the board.
    const walk = Animated.loop(
      Animated.sequence(
        PATH.map((_, index) =>
          Animated.timing(leg, {
            toValue: index + 1,
            duration: DRIFT_MS,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ),
      ),
    );
    walk.start();
    return () => walk.stop();
  }, [winner, stillness, enter, leg]);

  if (!spot || !winner || gone) return null;

  function hit() {
    if (!spot || splatting) return;
    // Remembered on the tap rather than when the ink clears, so leaving the
    // screen mid-splat has still popped it.
    markCongratsPopped(spot);
    setSplatting(true);
    // The wander stops where it was hit: the blot below lands on that spot,
    // because it rides the same drifting layer.
    leg.stopAnimation();
    Animated.timing(splat, {
      toValue: 1,
      duration: stillness ? 0 : SPLAT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => setGone(true));
  }

  const message = congratsMessage(winner, spot);
  /*
   * The path, in points, once both boxes have been measured.
   *
   * `x` is spent against the slack either side of the bubble, so full
   * deflection puts its edge at the edge of the board and never past it; `y`
   * against the height it is not itself taking up. Zero until the layout lands,
   * which simply means the bubble arrives at the top of the board and starts
   * moving on the next frame.
   */
  const slackX = Math.max(0, (area.width - bubble.width) / 2);
  const slackY = Math.max(0, area.height - bubble.height - space.xxl);
  const stops = [...PATH, PATH[0]].map((point) => ({
    x: point.x * slackX,
    y: point.y * slackY,
  }));
  const legs = stops.map((_, index) => index);
  const drift = {
    translateX: leg.interpolate({
      inputRange: legs,
      outputRange: stops.map((stop) => stop.x),
    }),
    translateY: leg.interpolate({
      inputRange: legs,
      outputRange: stops.map((stop) => stop.y),
    }),
  };

  return (
    // The layer the bubble wanders across, measured so the path can be a share
    // of the board. `box-none` so it places the bubble without swallowing taps
    // meant for the rows underneath.
    <View
      style={styles.layer}
      pointerEvents="box-none"
      onLayout={(event) => setArea(event.nativeEvent.layout)}
    >
      <Animated.View
        style={[
          styles.travelling,
          {
            transform: [
              { translateX: drift.translateX },
              { translateY: drift.translateY },
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
        pointerEvents="box-none"
      >
        {splatting ? (
          <InkSplat progress={splat} ink={theme.fg} />
        ) : (
          <Animated.View
            style={{
              opacity: enter,
              transform: [
                { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            }}
          >
            <Pressable
              onPress={hit}
              onLayout={(event) => setBubble(event.nativeEvent.layout)}
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
        )}
      </Animated.View>
    </View>
  );
}

/**
 * What is left when the bubble is hit: ink on the board.
 *
 * A game called WordInk should not burst its bubble into nothing. The blot is
 * built from overlapping circles rather than one -- a single circle is the one
 * thing ink never looks like -- struck on at speed, held for a beat and then
 * soaking away, with a spray of droplets thrown clear of it.
 *
 * Hidden from assistive technology entirely: the sentence was already announced
 * when the bubble arrived, and a screen reader has nothing to gain from being
 * told about a stain.
 */
function InkSplat({ progress, ink }: { progress: Animated.Value; ink: string }) {
  // Struck on hard and flattened, then soaking away: the overshoot in the first
  // fifth is the whole of what makes it read as landing rather than growing.
  const scale = progress.interpolate({
    inputRange: [0, 0.18, 0.36, 0.6, 1],
    outputRange: [0.15, 1.12, 0.94, 1, 1.06],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.18, 0.6, 1],
    outputRange: [0, 1, 0.95, 0],
  });

  return (
    <Animated.View
      style={[styles.splat, { opacity, transform: [{ scale }] }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {/* The body: four overlapping discs whose union is the silhouette, so the
          edge comes out lobed and off-centre the way a thrown drop does. */}
      <View style={[styles.lobe, styles.lobeCore, { backgroundColor: ink }]} />
      <View style={[styles.lobe, styles.lobeOne, { backgroundColor: ink }]} />
      <View style={[styles.lobe, styles.lobeTwo, { backgroundColor: ink }]} />
      <View style={[styles.lobe, styles.lobeThree, { backgroundColor: ink }]} />
      {DROPS.map((drop, index) => (
        <Animated.View
          key={index}
          style={[
            styles.drop,
            {
              width: drop.size,
              height: drop.size,
              borderRadius: drop.size / 2,
              backgroundColor: ink,
              opacity: progress.interpolate({
                inputRange: [0, 0.22, 0.6, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 0.6, 1],
                    outputRange: [0, drop.x, drop.x * 1.08],
                  }),
                },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 0.6, 1],
                    outputRange: [0, drop.y, drop.y * 1.08],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /* Over the board, filling it: the area the path is a share of. */
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: space.lg,
    zIndex: 20,
  },
  travelling: {
    alignItems: 'center',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 320,
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
  splat: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lobe: {
    position: 'absolute',
  },
  lobeCore: {
    width: 50,
    height: 50,
    borderRadius: 25,
    left: 13,
    top: 15,
  },
  lobeOne: {
    width: 30,
    height: 30,
    borderRadius: 15,
    left: 39,
    top: 7,
  },
  lobeTwo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    left: 10,
    top: 4,
  },
  lobeThree: {
    width: 32,
    height: 32,
    borderRadius: 16,
    left: 34,
    top: 40,
  },
  drop: {
    position: 'absolute',
  },
});

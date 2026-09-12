import { useEffect, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { syncHistory } from '../../src/game/leaderboard';
import { hasJoined, joinBoard } from '../../src/game/player';
import { hasSeen, markSeen } from '../../src/game/whatsNew';
import { InstructionsSheet } from './components/InstructionsSheet';
import { signalTap } from './host/feedback';
import { useAppState } from './hooks/useAppState';
import { FoundWordsScreen } from './screens/FoundWordsScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { PlayScreen } from './screens/PlayScreen';
import { space } from './theme/tokens';
import { useTheme } from './theme/useTheme';

type Route = 'game' | 'leaderboard' | 'found-words';

/**
 * The three pages, in the order a player meets them: the puzzle, then the two
 * things you go and look at once you have played it.
 *
 * Labels, no glyphs -- the website's reasoning holds here and then some. A
 * trophy is guessable and a scroll is not, and neither says which of the two
 * lists of words you are about to get: the boards rank players and the feed
 * collects words, which is exactly the distinction an icon cannot draw.
 */
const TABS: { route: Route; label: string }[] = [
  { route: 'game', label: 'Play' },
  { route: 'leaderboard', label: 'Leaderboards' },
  // "Words found" rather than "Today's finds": it opens on today but stepping
  // back a day is a thing it offers, and a tab that promises today then shows
  // Tuesday has misnamed itself.
  { route: 'found-words', label: 'Words found' },
];

/**
 * How long the app has to have been away before returning to it re-syncs.
 *
 * The same five minutes the website uses, and for the same reason: flicking to
 * another app and back is not an absence, and without a threshold every glance
 * away would cost a POST. On a phone the upper half of that reasoning is the
 * live one -- an app put down and picked up again really is opening the app.
 */
const SYNC_STALE_MS = 5 * 60_000;

/**
 * The app: one header, three pages, no router.
 *
 * The website has a real router because two of its pages are pages you link
 * someone to, open in a second tab, and reach with a back button. None of that
 * exists here, so the route is a piece of state and the tabs are the whole of
 * the navigation -- which is the same conclusion the Reddit build reached from
 * the same absence (see `setInMemoryRouting` in src/routes.ts).
 *
 * The two curator pages the website carries are deliberately absent. They are
 * reached by typing a URL with a key in it, and there is no URL to type.
 */
export function App() {
  const theme = useTheme();
  const [route, setRoute] = useState<Route>('game');

  // A player who has never tapped "?" never learns that rarer scores higher,
  // which is the whole game -- so the rules open themselves once, on a first
  // run, and never again.
  const [showInstructions, setShowInstructions] = useState(() => !hasSeen('instructions'));

  /*
   * Give this device a board identity before anything renders.
   *
   * Playing is the joining. The id is a UUID this install invents, kept in
   * local storage and sent with scores: no account, no email, nothing typed,
   * nothing about the person -- the name on the board is computed from the id
   * itself (see src/game/handle.ts).
   *
   * Minted during render rather than in the effect below, which is the one
   * unusual thing here and is load-bearing for the same reason it is on the
   * website: child effects run before a parent's, so a screen that reads the id
   * on mount would find none and ask the server for boards without saying who
   * was asking. Safe to run twice -- `joinBoard` keeps the first id.
   */
  const playerId = useRef<string | null>(null);
  if (playerId.current === null) playerId.current = joinBoard();

  /** When this install last sent its history, so a return can tell an absence from a glance. */
  const syncedAt = useRef(0);

  /*
   * Send what this device knows, every open -- not only on the first mint.
   *
   * Rows are written as the player plays, one request per accepted word, and
   * any of those can fail to land: a tunnel, the app killed on the last word, a
   * five-hundred from the endpoint. The per-day write is monotonic, so
   * re-sending is a repair rather than a rewrite -- a day already recorded is a
   * no-op, and only the gaps land.
   */
  useEffect(() => {
    syncHistory();
    syncedAt.current = Date.now();
  }, []);

  // And again when the app is reopened without being relaunched, which on a
  // phone is the usual way it is opened at all.
  useAppState({
    onForeground: () => {
      if (Date.now() - syncedAt.current < SYNC_STALE_MS) return;
      // Re-read rather than trusted from mount: a device that could not store
      // an id is not a player, and never becomes one by being reopened.
      if (!hasJoined()) return;
      syncHistory();
      syncedAt.current = Date.now();
    },
  });

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.bg }]} edges={['top', 'left', 'right']}>
        <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />

        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.bar}>
            {/* The wordmark alone. The website and the Reddit build both wear a
                "beta" chip beside it, which is honest -- the game really is
                changing under players week to week, and saying so once in the
                chrome is cheaper than a banner.

                This build cannot. App Store Review Guideline 2.2 rules out
                demos, betas and trial versions, and a label in the app's own
                header saying "beta" is the first thing a reviewer reads. The
                word is the risk, not the fact behind it: nothing about how
                often the game changes is different here, and the rules sheet
                still opens itself on a first run.

                Dropping it in the shared header instead would have taken the
                chip off the website too, where it is doing its job. */}
            <Text style={[styles.wordmark, { color: theme.fg }]} accessibilityRole="header">
              WordInk
            </Text>

            <Pressable
              onPress={() => {
                signalTap();
                setShowInstructions(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="How to play"
              hitSlop={space.md}
              style={({ pressed }) => [
                styles.help,
                { backgroundColor: theme.bgInset, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.helpGlyph, { color: theme.fg }]}>?</Text>
            </Pressable>
          </View>

          <View style={styles.nav} accessibilityRole="tablist">
            {TABS.map((tab) => {
              const current = tab.route === route;
              return (
                <Pressable
                  key={tab.route}
                  onPress={() => {
                    if (current) return;
                    signalTap();
                    setRoute(tab.route);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: current }}
                  style={[
                    styles.navItem,
                    current && { borderBottomColor: theme.accent, borderBottomWidth: 2 },
                  ]}
                >
                  <Text
                    style={[
                      styles.navLabel,
                      { color: current ? theme.fg : theme.fgMuted, fontWeight: current ? '800' : '600' },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.fill}>
          {route === 'leaderboard' ? (
            <LeaderboardScreen />
          ) : route === 'found-words' ? (
            <FoundWordsScreen />
          ) : (
            <PlayScreen onLeaderboard={() => setRoute('leaderboard')} />
          )}
        </View>

        <InstructionsSheet
          open={showInstructions}
          onClose={() => {
            // Opened by hand or opened for them, either way they have now met
            // the rules: retire the auto-open for good.
            markSeen('instructions');
            setShowInstructions(false);
          }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  wordmark: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  help: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpGlyph: {
    fontSize: 15,
    fontWeight: '800',
  },
  nav: {
    flexDirection: 'row',
    paddingHorizontal: space.sm,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    // A transparent underline on every tab, so selecting one does not change
    // the row's height.
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  navLabel: {
    fontSize: 13,
  },
});

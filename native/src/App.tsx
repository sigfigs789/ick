import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { syncHistoryWhenReady } from '../../src/game/leaderboard';
import { hasJoined, joinBoard } from '../../src/game/player';
import { takesPlayerMessages } from '../../src/game/playerMessages';
import { hasSeen, markSeen } from '../../src/game/whatsNew';
import { ChatButton, ChatSheet, useChatUnread } from './components/ChatSheet';
import { BookIcon, PlayIcon, StatsIcon, TrophyIcon } from './components/HeaderIcons';
import { HeaderMenu, type MenuItem } from './components/HeaderMenu';
import { InstructionsSheet } from './components/InstructionsSheet';
import { MenuSheet, type MenuSheetKind } from './components/MenuSheet';
import { UpdateBanner } from './components/UpdateBanner';
import { signalTap } from './host/feedback';
import { useAppState } from './hooks/useAppState';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import { FoundWordsScreen } from './screens/FoundWordsScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { PlayScreen } from './screens/PlayScreen';
import { StatsScreen } from './screens/StatsScreen';
import { space } from './theme/tokens';
import { useTheme } from './theme/useTheme';

type Route = 'game' | 'leaderboard' | 'found-words' | 'stats';

/**
 * The pages, as icons on the one bar beside the wordmark, in the website's
 * order (src/components/AppHeader.tsx): the puzzle, a book for the words
 * players found, a trophy for the boards, and bars for the player's own
 * numbers, right beside the "?".
 *
 * Icons rather than the row of labelled tabs this header used to carry under
 * the wordmark: one bar is the shape every daily word game's header has
 * settled on, and it gives the puzzle back a row. Each keeps its page's name as
 * its accessible name, so a screen reader still gets the word the glyph stands
 * for.
 *
 * The website draws Play for a share of its players only, as a test; this build
 * has always had a Play tab and keeps it -- with no wordmark link to fall back
 * on, it is the way back to the puzzle.
 */
const TABS: { route: Route; label: string; Icon: ComponentType<{ color: string }> }[] = [
  { route: 'game', label: 'Play', Icon: PlayIcon },
  // "Words found" rather than "Today's finds": it opens on today but stepping
  // back a day is a thing it offers, and a tab that promises today then shows
  // Tuesday has misnamed itself.
  { route: 'found-words', label: 'Words found', Icon: BookIcon },
  { route: 'leaderboard', label: 'Leaderboards', Icon: TrophyIcon },
  // Offered from the first visit, as on the website: before a word is banked
  // the page says so and points at the puzzle.
  { route: 'stats', label: 'Stats', Icon: StatsIcon },
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
 * The app: one header, four pages, no router.
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
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

/** Everything inside the provider, so the "?" menu can read the safe area. */
function Shell() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<Route>('game');
  // Whether this build has fallen below the leaderboard's floor with no
  // over-the-air update to close the gap -- see useUpdateCheck and UpdateBanner.
  const { behind } = useUpdateCheck();

  // A player who has never tapped "?" never learns that rarer scores higher,
  // which is the whole game -- so the rules open themselves once, on a first
  // run, and never again.
  const [showInstructions, setShowInstructions] = useState(() => !hasSeen('instructions'));

  // The chat, the same per-puzzle rooms the website's corner bubble opens.
  const [showChat, setShowChat] = useState(false);
  const chatUnread = useChatUnread(showChat);

  // The "?" menu, and the Feedback or Suggest a word sheet it opened, if any.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSheet, setMenuSheet] = useState<MenuSheetKind | null>(null);
  // Where the header ends, which the menu hangs from.
  const [headerHeight, setHeaderHeight] = useState(0);

  const menuItems: MenuItem[] = [
    { label: 'How to play', onPress: () => setShowInstructions(true) },
    // Only where the build takes messages, as on the website: a box that
    // answers "Thanks!" to a note that goes nowhere is the app lying.
    ...(takesPlayerMessages()
      ? [
          { label: 'Suggest a word', onPress: () => setMenuSheet('suggest-word') },
          { label: 'Feedback', onPress: () => setMenuSheet('feedback') },
        ]
      : []),
  ];

  const backToPlay = () => setRoute('game');

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
    syncHistoryWhenReady();
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
      syncHistoryWhenReady();
      syncedAt.current = Date.now();
    },
  });

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.bg }]} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />

      <View
        style={[styles.header, { borderBottomColor: theme.border }]}
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
        {/* The wordmark alone. The website and the Reddit build both wear a
            "beta" chip -- beside the wordmark once, on the Feedback sheet's
            title now -- which is honest: the game really is changing under
            players week to week, and saying so once is cheaper than a banner.

            This build cannot, anywhere. App Store Review Guideline 2.2 rules
            out demos, betas and trial versions, and a label in the app saying
            "beta" is the first thing a reviewer reads. The word is the risk,
            not the fact behind it: nothing about how often the game changes
            is different here, and the rules sheet still opens itself on a
            first run.

            Dropping it from the shared code instead would have taken the chip
            off the website too, where it is doing its job. */}
        {/* Two words, and only one of them is the name of anything. "Word" is
            what every game in this category is called; "Ink" is the half that
            makes it this one, so it wears the Mythic red -- the tier colour
            that is the same value in both themes, which is why it can be set
            here without a light and a dark spelling.

            One Text with a nested one rather than a row of two: a wordmark
            that wraps or spaces oddly is a broken name, and nesting keeps the
            pair kerned as the single word it is. Shrinks rather than wraps
            when the bar is short of room. */}
        <Text
          style={[styles.wordmark, { color: theme.fg }]}
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          Word
          <Text style={{ color: theme.rarity.Mythic.dot }}>Ink</Text>
        </Text>

        <View style={styles.actions}>
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
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected: current }}
                  hitSlop={2}
                  style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
                >
                  {/* The current page's disc is drawn inside the button
                      rather than to its edge, as on the website: it marks
                      the page without being the heaviest thing on the bar,
                      and the button keeps its full-size target. */}
                  <View style={[styles.iconDisc, current && { backgroundColor: theme.fg }]}>
                    <tab.Icon color={current ? theme.bg : theme.fgMuted} />
                  </View>
                </Pressable>
              );
            })}
          </View>

          <ChatButton
            unread={chatUnread}
            onPress={() => {
              signalTap();
              setShowChat(true);
            }}
          />
          <Pressable
            onPress={() => {
              signalTap();
              setMenuOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Help and settings"
            accessibilityState={{ expanded: menuOpen }}
            hitSlop={2}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: menuOpen ? theme.bgInset : 'transparent',
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.helpGlyph, { color: menuOpen ? theme.fg : theme.fgMuted }]}>?</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.fill}>
        {behind && route !== 'found-words' && <UpdateBanner />}
        {route === 'leaderboard' ? (
          <LeaderboardScreen onPlay={backToPlay} />
        ) : route === 'found-words' ? (
          <FoundWordsScreen onPlay={backToPlay} />
        ) : route === 'stats' ? (
          <StatsScreen onPlay={backToPlay} />
        ) : (
          <PlayScreen
            covered={showInstructions || showChat || menuOpen || menuSheet !== null}
            onSeeLeaderboard={() => setRoute('leaderboard')}
          />
        )}
      </View>

      <ChatSheet open={showChat} onClose={() => setShowChat(false)} />

      <HeaderMenu
        open={menuOpen}
        top={insets.top + headerHeight}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
      />

      <MenuSheet sheet={menuSheet} onClose={() => setMenuSheet(null)} />

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
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  /* One bar: the wordmark, then the page icons, the chat and the "?". */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wordmark: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  /* The website's 2.35rem circle, near enough. */
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpGlyph: {
    fontSize: 18,
    fontWeight: '700',
  },
});

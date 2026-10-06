import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { pullUpdate } from '../hooks/useUpdateCheck';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * Where "Update" goes when there is no over-the-air update to pull. The store
 * app's own scheme first, so the tap lands on the
 * listing rather than in a browser, and the web listing if the scheme will not
 * open.
 */
const STORE = Platform.select({
  ios: {
    app: 'itms-apps://apps.apple.com/app/id6812644489',
    web: 'https://apps.apple.com/app/id6812644489',
  },
  default: {
    app: 'market://details?id=app.wordink',
    web: 'https://play.google.com/store/apps/details?id=app.wordink',
  },
});

/**
 * The over-the-air update first -- the game is JavaScript, so that is almost
 * always what closes the gap, and it takes seconds rather than a store trip --
 * and the store only when there is none to pull.
 */
async function update(): Promise<void> {
  if (await pullUpdate()) return;
  await openStore();
}

async function openStore(): Promise<void> {
  try {
    await Linking.openURL(STORE.app);
  } catch {
    await Linking.openURL(STORE.web).catch(() => {});
  }
}

/**
 * Said when this build's scores have stopped ranking (see useUpdateCheck).
 *
 * A nudge rather than a wall. Nothing about playing is broken on an old build --
 * the round scores, the streak counts, the finds reach the feed -- so the one
 * thing lost is the board, and the banner says exactly that. It sits above Play
 * and Leaderboards and not Words found: the first is where scores are made, the
 * second is where their absence is noticed, and the feed is the one page an old
 * build is still fully part of.
 *
 * In the caution colours, not the danger ones: this is a thing to do, not a
 * thing that went wrong.
 */
export function UpdateBanner() {
  const theme = useTheme();
  // While the update downloads: the button says so and ignores further taps.
  // A successful pull reloads the app, so this only ever resets on the way to
  // the store.
  const [updating, setUpdating] = useState(false);
  return (
    <View
      style={[styles.banner, { backgroundColor: theme.cautionBg }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.message, { color: theme.cautionFg }]}>
        A new version of WordInk is out. Update to keep your scores on the leaderboard.
      </Text>
      <Pressable
        onPress={() => {
          signalTap();
          setUpdating(true);
          void update().finally(() => setUpdating(false));
        }}
        disabled={updating}
        accessibilityRole="button"
        accessibilityLabel="Update WordInk"
        accessibilityState={{ busy: updating, disabled: updating }}
        hitSlop={space.sm}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.accent, opacity: pressed || updating ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: theme.accentFg }]}>
          {updating ? 'Updating…' : 'Update'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  button: {
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  buttonLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
});

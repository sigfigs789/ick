import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * Where "Update" goes. The store app's own scheme first, so the tap lands on the
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
          void openStore();
        }}
        accessibilityRole="button"
        accessibilityLabel="Update WordInk"
        hitSlop={space.sm}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: theme.accentFg }]}>Update</Text>
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

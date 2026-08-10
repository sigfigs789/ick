import { StyleSheet, Text, View } from "react-native";
import { rarityScore } from "../game/dictionary";
import type { Rarity } from "../game/types";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

// Short text tags reinforce the color so rarity is never color-only
// information -- a colorblind or grayscale-display player reads the same
// thing a sighted player does. The dot is decorative reinforcement, not a
// second channel of meaning on its own.
const RARITY_META: Record<Rarity, { tag: string; key: keyof ReturnType<typeof useTheme>["rarity"] }> = {
  "Very Common": { tag: "VERY COMMON", key: "veryCommon" },
  Common: { tag: "COMMON", key: "common" },
  Uncommon: { tag: "UNCOMMON", key: "uncommon" },
  Rare: { tag: "RARE", key: "rare" },
  "Extremely Rare": { tag: "EXTREMELY RARE", key: "extremelyRare" },
};

interface Props {
  rarity: Rarity;
  /** Precomputed Zipf frequency -- converted to a rarity score (higher = rarer) for display. */
  zipf?: number;
}

export function RarityBadge({ rarity, zipf }: Props) {
  const theme = useTheme();
  const meta = RARITY_META[rarity];
  const colors = theme.rarity[meta.key];

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <View style={[styles.dot, { backgroundColor: colors.dot }]} />
      <Text style={[styles.text, { color: colors.fg }]}>{meta.tag}</Text>
      {zipf !== undefined && (
        <Text style={[styles.score, { color: colors.fg }]}>
          {" "}
          · {rarityScore(zipf).toFixed(1)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginRight: 6,
  },
  text: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  score: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    opacity: 0.7,
  },
});

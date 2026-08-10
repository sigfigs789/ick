import { StyleSheet, Text, View } from "react-native";
import type { StreakState } from "../game/types";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  streak: StreakState;
}

export function StreakDisplay({ streak }: Props) {
  const theme = useTheme();
  return (
    <View
      style={styles.row}
      accessibilityLabel={`Current streak: ${streak.currentStreak} days`}
    >
      <Text style={styles.flame}>🔥</Text>
      <Text style={[styles.count, { color: theme.fg }]}>{streak.currentStreak}</Text>
      <Text style={[styles.unit, { color: theme.fgMuted }]}>day streak</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  flame: {
    fontSize: 14,
  },
  count: {
    fontFamily: fonts.displayBlack,
    fontSize: 15,
  },
  unit: {
    fontFamily: fonts.body,
    fontSize: 14,
  },
});

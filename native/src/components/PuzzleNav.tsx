import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDateLabel } from "../game/date";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  date: string;
  puzzleNumber: number;
  isToday: boolean;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function PuzzleNav({
  date,
  puzzleNumber,
  isToday,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
  onToday,
}: Props) {
  const theme = useTheme();
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={onPrevious}
          disabled={!canGoToPrevious}
          accessibilityLabel="Previous puzzle"
          style={[
            styles.arrow,
            { borderColor: theme.border, backgroundColor: theme.cardBg },
            !canGoToPrevious && styles.arrowDisabled,
          ]}
        >
          <Text style={{ color: theme.fgMuted }}>‹</Text>
        </Pressable>
        <Text style={[styles.number, { color: theme.fgFaint }]}>
          Puzzle #{puzzleNumber} · {formatDateLabel(date)}
          {!isToday && <Text style={[styles.archiveTag, { color: theme.rarity.uncommon.fg }]}> (archive)</Text>}
        </Text>
        <Pressable
          onPress={onNext}
          disabled={!canGoToNext}
          accessibilityLabel="Next puzzle"
          style={[
            styles.arrow,
            { borderColor: theme.border, backgroundColor: theme.cardBg },
            !canGoToNext && styles.arrowDisabled,
          ]}
        >
          <Text style={{ color: theme.fgMuted }}>›</Text>
        </Pressable>
      </View>
      {!isToday && (
        <Pressable onPress={onToday} style={styles.todayButton}>
          <Text style={[styles.todayText, { color: theme.focusRing }]}>Back to today</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  arrow: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowDisabled: {
    opacity: 0.3,
  },
  number: {
    fontFamily: fonts.body,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  archiveTag: {
    fontFamily: fonts.bodyBold,
  },
  todayButton: {
    alignSelf: "center",
    marginTop: 5,
  },
  todayText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    textDecorationLine: "underline",
  },
});

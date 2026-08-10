import { StyleSheet, Text, View } from "react-native";
import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { todayShareText } from "../game/share";
import { RarityBadge } from "./RarityBadge";
import { ShareButton } from "./ShareButton";
import type { AcceptedWord, StreakState } from "../game/types";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
}

export function ResultsPanel({ drop, words, streak }: Props) {
  const theme = useTheme();
  const shareText = todayShareText(drop, words);
  const best = bestWord(words);

  return (
    <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.cardBg }]}>
      <Text style={[styles.heading, { color: theme.fg }]}>Puzzle complete!</Text>
      <Text style={[styles.summary, { color: theme.fgMuted }]}>
        You found {words.length} word{words.length === 1 ? "" : "s"} containing{" "}
        <Text style={styles.bold}>{drop.toUpperCase()}</Text> in {words.length} of {MAX_GUESSES}{" "}
        guesses.
      </Text>

      {best && (
        <View
          style={[
            styles.best,
            {
              backgroundColor: theme.rarity.extremelyRare.bg,
              borderColor: theme.rarity.extremelyRare.dot,
            },
          ]}
        >
          <Text style={[styles.bestLabel, { color: theme.fgMuted }]}>Your best word</Text>
          <Text style={[styles.bestWord, { color: theme.fg }]}>👑 {best.word}</Text>
          <RarityBadge rarity={best.rarity} zipf={best.zipf} />
        </View>
      )}

      <View style={styles.list}>
        {words.map((w) => (
          <View
            key={w.word}
            style={[styles.listItem, { backgroundColor: theme.bgInset, borderColor: theme.border }]}
          >
            <Text style={[styles.word, { color: theme.fg }]}>{w.word}</Text>
            <RarityBadge rarity={w.rarity} zipf={w.zipf} />
          </View>
        ))}
      </View>

      <Text style={[styles.streak, { color: theme.fgMuted }]}>
        🔥 {streak.currentStreak} day streak
        {streak.longestStreak > streak.currentStreak ? ` · best: ${streak.longestStreak}` : ""}
      </Text>

      <ShareButton text={shareText} />

      <View style={[styles.preview, { backgroundColor: theme.bgInset, borderColor: theme.border }]}>
        <Text style={[styles.previewText, { color: theme.fgMuted }]}>{shareText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 16,
    padding: 22,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heading: {
    fontFamily: fonts.displayBlack,
    fontSize: 22,
    marginBottom: 6,
    textAlign: "center",
  },
  summary: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    textAlign: "center",
    marginBottom: 18,
    lineHeight: 20,
  },
  bold: {
    fontFamily: fonts.bodyExtraBold,
  },
  best: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 22,
    marginBottom: 18,
    borderRadius: 14,
    borderWidth: 1,
  },
  bestLabel: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  bestWord: {
    fontFamily: fonts.displayBlack,
    fontSize: 24,
    textTransform: "lowercase",
  },
  list: {
    width: "100%",
    gap: 9,
    marginBottom: 18,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 10,
  },
  word: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    textTransform: "lowercase",
  },
  streak: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    marginBottom: 18,
  },
  preview: {
    marginTop: 18,
    width: "100%",
    padding: 13,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 9,
  },
  previewText: {
    fontFamily: fonts.body,
    fontSize: 13,
  },
});

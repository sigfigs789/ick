import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { RarityBadge } from "./RarityBadge";
import type { AcceptedWord } from "../game/types";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  acceptedWords: AcceptedWord[];
  /** Tapping a logged word loads it back into the guess input for tweaking. */
  onSelectWord: (word: string) => void;
}

export function GuessLog({ acceptedWords, onSelectWord }: Props) {
  const theme = useTheme();
  const best = bestWord(acceptedWords);
  const guessesLeft = MAX_GUESSES - acceptedWords.length;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.fg, fontFamily: fonts.bodyExtraBold }]}>
          Guess log
        </Text>
        <Text style={[styles.count, { color: theme.fgFaint }]}>
          {acceptedWords.length} of {MAX_GUESSES} used
        </Text>
      </View>

      {acceptedWords.length === 0 ? (
        <View style={[styles.empty, { borderColor: theme.border, backgroundColor: theme.bgInset }]}>
          <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
            No guesses yet — enter a word below that contains the ink.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {acceptedWords.map((w, i) => {
            const isBest = best !== undefined && w.word === best.word;
            return (
              <Entry
                key={w.word}
                word={w}
                index={i}
                isBest={isBest}
                onPress={() => onSelectWord(w.word)}
              />
            );
          })}
        </View>
      )}

      {guessesLeft > 0 && acceptedWords.length > 0 && (
        <Text style={[styles.remaining, { color: theme.fgMuted }]}>
          {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left. Aim for the highest rarity you can
          find.
        </Text>
      )}
    </View>
  );
}

function Entry({
  word,
  index,
  isBest,
  onPress,
}: {
  word: AcceptedWord;
  index: number;
  isBest: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.entry,
        {
          borderColor: isBest ? theme.rarity.extremelyRare.dot : theme.borderStrong,
          backgroundColor: isBest ? theme.rarity.extremelyRare.bg : theme.cardBg,
          opacity: anim,
          transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={styles.wordButton}
        accessibilityLabel={`Reuse "${word.word}" (${word.rarity}, guess ${index + 1}) in the input`}
      >
        {isBest && <Text style={styles.crown}>👑</Text>}
        <Text style={[styles.word, { color: theme.fg }]}>{word.word}</Text>
      </Pressable>
      <RarityBadge rarity={word.rarity} zipf={word.zipf} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
  },
  count: {
    fontSize: 12.5,
  },
  empty: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14.5,
  },
  list: {
    gap: 9,
  },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 54,
    paddingVertical: 6,
    paddingLeft: 14,
    paddingRight: 8,
    borderWidth: 2,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  wordButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  crown: {
    fontSize: 16,
  },
  word: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  remaining: {
    fontFamily: fonts.body,
    marginTop: 11,
    fontSize: 13,
    textAlign: "center",
  },
});

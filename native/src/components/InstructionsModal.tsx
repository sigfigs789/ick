import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STEPS: Array<{ text: string; bold?: string[] }> = [
  {
    text: 'WordInk gives everyone the same daily ink — say, “INK”. Your job is to dip into your vocabulary and pull out words stained with it, like drINK, thINK, or pINK.',
    bold: ["INK", "drINK", "thINK", "pINK"],
  },
  { text: "Enter valid English words that contain those letters together, in that order — you get up to 6 distinct words." },
  { text: "Blot the page all you want: submitting an invalid word just gives you feedback — no penalty, no timer, and it doesn't use up a guess." },
  { text: "Each accepted word reveals a rarity, from Very Common to Extremely Rare. The goal is finding the rarest word you can — your inkiest gem gets crowned 👑 in the log." },
  { text: 'Stop anytime with "Lock in my result," or use all 6 guesses — either way completes the day and keeps your streak going.' },
  { text: "Tap any word already in your log to load it back into the box if you want to try a variation." },
];

export function InstructionsModal({ open, onClose }: Props) {
  const theme = useTheme();

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.modal, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={[styles.heading, { color: theme.fg }]}>How to play WordInk</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close instructions"
              style={[styles.close, { backgroundColor: theme.bgInset, borderColor: theme.border }]}
            >
              <Text style={{ color: theme.fg, fontSize: 18, lineHeight: 20 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView>
            {STEPS.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={[styles.marker, { color: theme.fgFaint }]}>{i + 1}.</Text>
                <Text style={[styles.stepText, { color: theme.fgMuted }]}>{step.text}</Text>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modal: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    maxWidth: 420,
    width: "100%",
    maxHeight: "82%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  heading: {
    fontFamily: fonts.displayBlack,
    fontSize: 20,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  marker: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 21,
  },
});

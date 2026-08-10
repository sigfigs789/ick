import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text } from "react-native";
import type { Feedback } from "../hooks/useDailyPuzzle";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  feedback: Feedback | null;
}

const VISIBLE_MS = 3200;

/** A small toast that fades in and back out, matching the web version's live region. */
export function FeedbackRegion({ feedback }: Props) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!feedback) return;
    AccessibilityInfo.announceForAccessibility(feedback.message);
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback, opacity]);

  if (!feedback) return null;

  const colors =
    feedback.kind === "accepted"
      ? { bg: theme.successBg, fg: theme.successFg }
      : { bg: theme.dangerBg, fg: theme.dangerFg };

  return (
    <Animated.View style={[styles.toast, { backgroundColor: colors.bg, opacity }]}>
      <Text style={[styles.text, { color: colors.fg }]}>{feedback.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    marginVertical: 10,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
  },
});

import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Feedback } from "../hooks/useDailyPuzzle";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  drop: string;
  disabled: boolean;
  feedback: Feedback | null;
  /** Set by tapping a word in the guess log; consumed once, then cleared by the parent. */
  prefill: { word: string; token: number } | null;
  onSubmit: (word: string) => void;
}

export function SubmitForm({ drop, disabled, feedback, prefill, onSubmit }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const inputRef = useRef<TextInput>(null);
  const shakeX = useRef(new Animated.Value(0)).current;

  function handleSubmit() {
    if (!value.trim() || disabled) return;
    onSubmit(value);
    setValue("");
  }

  // A log entry was tapped: load its word into the box and focus it so
  // the player can tweak and resubmit it directly.
  useEffect(() => {
    if (!prefill) return;
    setValue(prefill.word);
    inputRef.current?.focus();
  }, [prefill]);

  // Wordle-style shake on a rejected submission.
  useEffect(() => {
    if (feedback?.kind !== "rejected") return;
    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -6, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -4, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 4, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [feedback, shakeX]);

  return (
    <View style={styles.form}>
      <Text style={[styles.label, { color: theme.fgMuted }]}>
        {disabled
          ? "You've completed this puzzle"
          : `Enter a word containing "${drop.toUpperCase()}"`}
      </Text>
      <Animated.View style={[styles.row, { transform: [{ translateX: shakeX }] }]}>
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            {
              color: theme.fg,
              backgroundColor: theme.cardBg,
              borderColor: theme.borderStrong,
            },
          ]}
          value={value}
          editable={!disabled}
          onChangeText={setValue}
          placeholder={disabled ? "" : "type a word…"}
          placeholderTextColor={theme.fgFaint}
          maxLength={30}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        <Pressable
          onPress={handleSubmit}
          disabled={disabled || !value.trim()}
          style={[
            styles.button,
            { backgroundColor: theme.accent },
            (disabled || !value.trim()) && styles.buttonDisabled,
          ]}
        >
          <Text style={[styles.buttonText, { color: theme.accentFg }]}>Submit</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    marginBottom: 12,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.displaySemibold,
    fontSize: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderRadius: 10,
  },
  button: {
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
});

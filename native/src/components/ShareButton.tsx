import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  text: string;
}

export function ShareButton({ text }: Props) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  async function handlePress() {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Pressable onPress={handlePress} style={[styles.button, { backgroundColor: theme.accent }]}>
      <Text style={[styles.text, { color: theme.accentFg }]}>
        {copied ? "Copied!" : "Share result"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    paddingHorizontal: 22,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
});

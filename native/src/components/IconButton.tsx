import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "../theme/useTheme";

interface Props {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}

/** The circular header icon button used for both the sound toggle and the help ("?") button. */
export function IconButton({ onPress, accessibilityLabel, children }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={[styles.button, { borderColor: theme.border, backgroundColor: theme.cardBg }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

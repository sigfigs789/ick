import { Pressable, StyleSheet, Text } from "react-native";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  onLockIn: () => void;
}

export function LockInButton({ onLockIn }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onLockIn}
      style={[styles.button, { borderColor: theme.borderStrong, backgroundColor: theme.bgInset }]}
    >
      <Text style={[styles.text, { color: theme.fg }]}>Lock in my result</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 2,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    marginBottom: 12,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 14.5,
    letterSpacing: 0.3,
  },
});

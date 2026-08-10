import { Text } from "react-native";
import { IconButton } from "./IconButton";

interface Props {
  enabled: boolean;
  onToggle: () => void;
}

export function SoundToggle({ enabled, onToggle }: Props) {
  return (
    <IconButton
      onPress={onToggle}
      accessibilityLabel={enabled ? "Mute sound effects" : "Unmute sound effects"}
    >
      <Text style={{ fontSize: 17 }}>{enabled ? "🔊" : "🔇"}</Text>
    </IconButton>
  );
}

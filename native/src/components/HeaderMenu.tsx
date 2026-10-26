import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export interface MenuItem {
  label: string;
  onPress: () => void;
}

interface Props {
  open: boolean;
  /** How far down the screen the header's bottom edge is, which the panel hangs from. */
  top: number;
  items: readonly MenuItem[];
  onClose: () => void;
}

/**
 * The "?" menu: a short list of plain rows hanging from the header's right
 * edge -- How to play, Suggest a word, Feedback -- as the website's is
 * (src/components/AppHeader.tsx), with room for whatever the game grows next
 * without the bar growing with it.
 *
 * Without the website's Standard | Freeform switch at its foot: this build
 * plays one mode.
 *
 * A transparent modal rather than a view positioned under the header, because
 * a press anywhere outside the panel has to close it, and only something above
 * the whole screen can hear a press on the puzzle below. It closes after any
 * choice in it too, and on Android's back gesture.
 */
export function HeaderMenu({ open, top, items, onClose }: Props) {
  const theme = useTheme();

  /*
   * The choice made, held until this menu has finished going away.
   *
   * Every row opens a sheet, and a sheet is a modal of its own. iOS
   * will not present a modal while another is still dismissing -- it drops it
   * without a word -- so there the row's action waits for `onDismiss`. Android
   * has no such rule and no `onDismiss` to wait for, so it goes at once.
   */
  const pending = useRef<(() => void) | null>(null);
  function choose(item: MenuItem) {
    onClose();
    if (Platform.OS === 'ios') pending.current = item.onPress;
    else item.onPress();
  }

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={() => {
        const action = pending.current;
        pending.current = null;
        action?.();
      }}
      statusBarTranslucent
    >
      <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close menu">
        {/* Swallows presses between the rows, so only one outside the panel closes it. */}
        <Pressable
          onPress={() => {}}
          style={[styles.panel, { top, backgroundColor: theme.cardBg, borderColor: theme.border }]}
          accessibilityViewIsModal
        >
          {items.map((item, index) => (
            <Pressable
              key={item.label}
              onPress={() => choose(item)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.item,
                // Rules between the rows, so each reads as its own button.
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                pressed && { backgroundColor: theme.bgInset },
              ]}
            >
              <Text style={[styles.label, { color: theme.fg }]}>{item.label}</Text>
              {/* The "›" that says the row opens something. */}
              <Text style={[styles.chevron, { color: theme.fgFaint }]} importantForAccessibility="no">
                ›
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  /* As wide as its longest item, so a short menu is not padded out. */
  panel: {
    position: 'absolute',
    right: space.lg,
    padding: 4,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 20,
    lineHeight: 22,
  },
});

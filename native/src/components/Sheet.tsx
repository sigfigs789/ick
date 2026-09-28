import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  open: boolean;
  /** A node, not a string, so the rules sheet can colour the Ink of its name. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** A confirmation rather than a reading sheet: no scroll, actions supplied by the caller. */
  compact?: boolean;
}

/**
 * The one modal shape, for the rules, the word rules and the reveal
 * confirmation.
 *
 * A sheet from the bottom rather than a centred dialog. On a phone the bottom
 * is where a thumb is, and the sheet's own header carries the only way out --
 * which matters more here than on the website: there is no Escape key and no
 * click-outside habit to fall back on, so the close control has to be visible
 * rather than implied. Tapping the scrim still closes it for the players who
 * do reach for that, and `onRequestClose` wires up Android's back gesture,
 * which is the one a dialog on that platform must answer.
 */
export function Sheet({ open, title, onClose, children, compact = false }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityElementsHidden>
        {/* Swallows taps that land on the sheet itself, so only the scrim closes. */}
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.border,
              paddingBottom: insets.bottom + space.lg,
              maxHeight: compact ? undefined : '85%',
            },
          ]}
          onPress={() => {}}
          accessibilityViewIsModal
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.fg }]} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={space.md}
              style={({ pressed }) => [
                styles.close,
                { backgroundColor: theme.bgInset, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.closeGlyph, { color: theme.fg }]}>✕</Text>
            </Pressable>
          </View>

          {compact ? (
            <View style={styles.body}>{children}</View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '800',
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    flexGrow: 0,
  },
  body: {
    padding: space.lg,
    gap: space.md,
  },
});

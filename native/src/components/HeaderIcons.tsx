import { StyleSheet, View } from 'react-native';

/**
 * The header's page icons -- a play button, a book, a trophy and a bar chart,
 * the same four the website's bar draws (src/components/AppHeader.tsx).
 *
 * Drawn from Views rather than SVG. The website's are 24-unit line drawings,
 * and the obvious port is react-native-svg, but that is a native module: adding
 * it changes the build's fingerprint, and a fingerprint change means the next
 * release can only go out through the store rather than over the air (see
 * tools/check-native-fingerprint.cjs). Four small glyphs are not worth that, and
 * boxes with borders and a rounded corner or two get every one of them close
 * enough to read as the same icon.
 *
 * Each takes the one colour it is drawn in, so the current page can invert it
 * against its disc the way the website's `currentColor` does.
 */

interface IconProps {
  color: string;
}

/** The stroke every icon is drawn with, as the website's strokeWidth="2". */
const STROKE = 2;

/** A triangle pointing right: the puzzle. */
export function PlayIcon({ color }: IconProps) {
  return (
    <View style={styles.box}>
      <View
        style={{
          width: 0,
          height: 0,
          // Nudged right of centre, as a play glyph's weight sits on its flat side.
          marginLeft: 3,
          borderLeftWidth: 13,
          borderTopWidth: 8,
          borderBottomWidth: 8,
          borderLeftColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
    </View>
  );
}

/** An open book, two pages meeting at the spine: the words players found. */
export function BookIcon({ color }: IconProps) {
  const page = { borderColor: color, borderWidth: STROKE, width: 9, height: 14 };
  return (
    <View style={[styles.box, styles.row]}>
      <View style={[page, { borderTopRightRadius: 5, borderBottomRightRadius: 1 }]} />
      <View style={[page, { marginLeft: -STROKE, borderTopLeftRadius: 5, borderBottomLeftRadius: 1 }]} />
    </View>
  );
}

/** A cup with two handles on a stem and base: the boards. */
export function TrophyIcon({ color }: IconProps) {
  const handle = {
    position: 'absolute' as const,
    top: 2,
    width: 5,
    height: 6,
    borderColor: color,
    borderWidth: STROKE,
  };
  return (
    <View style={styles.box}>
      <View style={{ width: 18, alignItems: 'center' }}>
        <View
          style={[handle, { left: 0, borderRightWidth: 0, borderTopLeftRadius: 1, borderBottomLeftRadius: 4 }]}
        />
        <View
          style={[handle, { right: 0, borderLeftWidth: 0, borderTopRightRadius: 1, borderBottomRightRadius: 4 }]}
        />
        <View
          style={{
            width: 11,
            height: 9,
            borderColor: color,
            borderWidth: STROKE,
            borderBottomLeftRadius: 6,
            borderBottomRightRadius: 6,
          }}
        />
        <View style={{ width: STROKE, height: 4, backgroundColor: color }} />
        <View style={{ width: 9, height: STROKE + 1, borderRadius: 1, backgroundColor: color }} />
      </View>
    </View>
  );
}

/** Three bars on a baseline: the player's own numbers. */
export function StatsIcon({ color }: IconProps) {
  const bar = { width: STROKE, borderRadius: 1, backgroundColor: color };
  return (
    <View style={styles.box}>
      <View style={styles.bars}>
        <View style={[bar, { height: 9 }]} />
        <View style={[bar, { height: 15 }]} />
        <View style={[bar, { height: 6 }]} />
      </View>
      <View style={{ width: 18, height: STROKE, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  /* The website's 22px icon box, centred. */
  box: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: 1,
  },
});

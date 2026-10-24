import { useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { REST_DAY_PLAYS } from '../../../src/game/streakFreeze';
import { signalTap } from '../host/feedback';
import { useTheme } from '../theme/useTheme';

/** What the 😴 means on a day of the weekend itself, for its popup. */
const REST_DAY_RULE = "3 days played, so the weekend's all yours: skipping today can't break the streak.";

/** What the badge means on a weekday, with `played` of the week's days played. */
function weekdayRule(played: number, reachable: boolean): string {
  if (played >= REST_DAY_PLAYS) {
    return "Unlocked: kick back all weekend, skipping Saturday and Sunday can't break your streak.";
  }
  if (!reachable) {
    return 'Play any 3 days by Friday and unlock a lazy weekend 😴 that protects your streak all Saturday and Sunday';
  }
  return `Play 3 days by Friday and snooze through the weekend: skipping it can't break your streak. ${played} of 3 so far.`;
}

/** The side of the screen a popup keeps clear of, the website's 1rem. */
const EDGE = 16;

/**
 * A badge's explanation, hung above it: the website's freeze and rest-day
 * popups, which open on a press and close on another.
 *
 * Absolutely positioned over whatever sits above the badge, as on the website,
 * rather than pushing the page down. A popup has no width of its own to shrink
 * to in React Native, so it is given the website's maximum, and slid sideways
 * to stay `EDGE` clear of the screen's sides -- the badge it belongs to is
 * measured on opening for that.
 */
export function BadgePopup({
  open,
  onToggle,
  maxWidth,
  title,
  text,
  accessibilityLabel,
  style,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** The website's max-width: 15rem for the rest day, 17rem for freezes. */
  maxWidth: number;
  title: string;
  text: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const wrapRef = useRef<View>(null);
  const width = Math.min(maxWidth, screenWidth - 2 * EDGE);
  // Where the popup's left edge sits relative to the badge, once measured.
  const [left, setLeft] = useState<number | null>(null);

  function toggle() {
    signalTap();
    if (!open) {
      wrapRef.current?.measureInWindow((x, _y, badgeWidth) => {
        const centred = x + badgeWidth / 2 - width / 2;
        const clamped = Math.max(EDGE, Math.min(centred, screenWidth - EDGE - width));
        setLeft(clamped - x);
      });
    }
    onToggle();
  }

  return (
    <View ref={wrapRef} style={[styles.wrap, open && styles.wrapOpen, style]} collapsable={false}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        style={styles.button}
      >
        {children}
      </Pressable>
      {open && (
        <Pressable
          onPress={toggle}
          accessibilityLabel={`${title}. ${text}`}
          style={[
            styles.popup,
            {
              width,
              left: left ?? -width / 2,
              opacity: left === null ? 0 : 1,
              backgroundColor: theme.bg,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.popupTitle, { color: theme.fg }]}>{title}</Text>
          <Text style={[styles.popupText, { color: theme.fgMuted }]}>{text}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * A pie a third full for each day played, drawn in the muted text colour.
 *
 * The website draws it as an SVG arc. There is no SVG here, so it is the
 * two-halves trick: each half of the circle is a clipped window, and a
 * half-disc rotated into it fills that window up to the angle.
 */
export function WeekPie({ played, size = 15 }: { played: number; size?: number }) {
  const theme = useTheme();
  const color = theme.fgMuted;
  const r = size / 2;
  const angle = Math.max(0, Math.min(1, played / REST_DAY_PLAYS)) * 360;
  // The right window shows 0..min(angle, 180) clockwise from twelve o'clock;
  // the left one the rest.
  const rightTurn = Math.min(angle, 180);
  const leftTurn = Math.max(0, angle - 180);
  return (
    <View
      style={[
        styles.pie,
        { width: size, height: size, borderRadius: r },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {angle > 0 && (
        <View style={[styles.pieHalf, { left: r, width: r, height: size }]}>
          <View
            style={{
              position: 'absolute',
              left: -r,
              width: size,
              height: size,
              transform: [{ rotate: `${rightTurn}deg` }],
            }}
          >
            <View
              style={{
                width: r,
                height: size,
                backgroundColor: color,
                borderTopLeftRadius: r,
                borderBottomLeftRadius: r,
              }}
            />
          </View>
        </View>
      )}
      {leftTurn > 0 && (
        <View style={[styles.pieHalf, { left: 0, width: r, height: size }]}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              width: size,
              height: size,
              transform: [{ rotate: `${leftTurn}deg` }],
            }}
          >
            <View
              style={{
                marginLeft: r,
                width: r,
                height: size,
                backgroundColor: color,
                borderTopRightRadius: r,
                borderBottomRightRadius: r,
              }}
            />
          </View>
        </View>
      )}
      <View style={[styles.pieRing, { borderRadius: r, borderColor: color }]} />
    </View>
  );
}

/**
 * The lazy weekend badge. On the weekend itself (no `played`), the 😴 shown
 * on a streak taking a day of the weekend off its week's play earned (see `resting`
 * in src/game/streakFreeze.ts). On a weekday, given the week's days `played`,
 * a pie filling a third a day that turns 😴 on the third (see `isRestDay`).
 * Pressing it opens a popup with the rule; pressing it, or the popup, again
 * closes it.
 */
export function RestDayBadge({
  played,
  reachable = true,
  style,
  fontSize = 14.4,
}: {
  played?: number;
  /** Whether three days can still be played this week; the rule then speaks of next week. */
  reachable?: boolean;
  style?: StyleProp<ViewStyle>;
  /** The size of the text it sits in, which the 😴 matches. */
  fontSize?: number;
}) {
  const rule = played === undefined ? REST_DAY_RULE : weekdayRule(played, reachable);
  const unlocked = played === undefined || played >= REST_DAY_PLAYS;
  const [open, setOpen] = useState(false);

  return (
    <BadgePopup
      open={open}
      onToggle={() => setOpen((was) => !was)}
      maxWidth={240}
      title="Lazy weekend"
      text={rule}
      accessibilityLabel={`Lazy weekend: ${rule}`}
      style={style}
    >
      {unlocked ? <Text style={{ fontSize }}>😴</Text> : <WeekPie played={played} size={fontSize} />}
    </BadgePopup>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  // Over the badges after it in the row, which would otherwise paint on top.
  wrapOpen: {
    zIndex: 20,
    elevation: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /* .rest-day__popup / .streak-display__freeze-popup */
  popup: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: 8,
    gap: 5.6,
    paddingVertical: 11.2,
    paddingHorizontal: 13.6,
    borderWidth: 1,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  popupTitle: {
    fontSize: 13.6,
    lineHeight: 19,
    fontWeight: '700',
  },
  popupText: {
    fontSize: 13.6,
    lineHeight: 19,
  },
  pie: {
    overflow: 'hidden',
  },
  pieHalf: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  pieRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1.5,
  },
});

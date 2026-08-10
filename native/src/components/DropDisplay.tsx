import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { fonts } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

interface Props {
  drop: string;
}

export function DropDisplay({ drop }: Props) {
  const theme = useTheme();
  // One Animated.Value per letter, staggered 80ms apart -- mirrors the
  // web version's nth-child animation-delay tile-in.
  const anims = useRef(drop.split("").map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      80,
      anims.map((a) =>
        Animated.spring(a, {
          toValue: 1,
          useNativeDriver: true,
          friction: 7,
          tension: 60,
        })
      )
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.fgFaint }]}>Today's drop</Text>
      <View style={styles.row}>
        {drop.split("").map((ch, i) => {
          const anim = anims[i];
          return (
            <Animated.View
              key={i}
              style={[
                styles.letter,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.borderStrong,
                  opacity: anim,
                  transform: [
                    { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                    { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                  ],
                },
              ]}
            >
              <Text style={[styles.letterText, { color: theme.fg }]}>{ch}</Text>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginBottom: 28,
  },
  label: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  letter: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  letterText: {
    fontFamily: fonts.displayBlack,
    fontSize: 28,
  },
});

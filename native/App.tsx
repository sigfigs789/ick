import { Karla_400Regular, Karla_500Medium, Karla_700Bold, Karla_800ExtraBold } from "@expo-google-fonts/karla";
import {
  LibreFranklin_600SemiBold,
  LibreFranklin_700Bold,
  LibreFranklin_800ExtraBold,
  LibreFranklin_900Black,
} from "@expo-google-fonts/libre-franklin";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { DropDisplay } from "./src/components/DropDisplay";
import { FeedbackRegion } from "./src/components/FeedbackRegion";
import { GuessLog } from "./src/components/GuessLog";
import { IconButton } from "./src/components/IconButton";
import { InstructionsModal } from "./src/components/InstructionsModal";
import { LockInButton } from "./src/components/LockInButton";
import { PuzzleNav } from "./src/components/PuzzleNav";
import { ResultsPanel } from "./src/components/ResultsPanel";
import { SoundToggle } from "./src/components/SoundToggle";
import { StreakDisplay } from "./src/components/StreakDisplay";
import { SubmitForm } from "./src/components/SubmitForm";
import { useDailyPuzzle } from "./src/hooks/useDailyPuzzle";
import { useSound } from "./src/hooks/useSound";
import { fonts } from "./src/theme/theme";
import { useTheme } from "./src/theme/useTheme";

SplashScreen.preventAutoHideAsync();

export default function App() {
  const theme = useTheme();
  const [fontsLoaded] = useFonts({
    Karla_400Regular,
    Karla_500Medium,
    Karla_700Bold,
    Karla_800ExtraBold,
    LibreFranklin_600SemiBold,
    LibreFranklin_700Bold,
    LibreFranklin_800ExtraBold,
    LibreFranklin_900Black,
  });

  const {
    date,
    puzzleNumber,
    isToday,
    canGoToPrevious,
    canGoToNext,
    goToPrevious,
    goToNext,
    goToToday,
    drop,
    progress,
    streak,
    isLoading,
    feedback,
    submitWord,
    lockIn,
  } = useDailyPuzzle();
  const [showInstructions, setShowInstructions] = useState(false);
  const [prefill, setPrefill] = useState<{ word: string; token: number } | null>(null);
  const sound = useSound();

  // Clear any pending prefill when the viewed puzzle changes so a stale
  // tap-to-reuse value from a different day's log can't leak in.
  useEffect(() => {
    setPrefill(null);
  }, [date]);

  // Play a chime/buzz on every submission, pitched by rarity when accepted.
  const feedbackKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!feedback || feedback.key === feedbackKeyRef.current) return;
    feedbackKeyRef.current = feedback.key;
    if (feedback.kind === "accepted" && feedback.rarity) {
      sound.accept(feedback.rarity);
    } else if (feedback.kind === "rejected") {
      sound.reject();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  // Play the completion fanfare only on the transition into "completed",
  // not on load when reopening an already-finished puzzle.
  const wasCompleted = useRef(progress.completed);
  useEffect(() => {
    if (progress.completed && !wasCompleted.current) {
      sound.complete();
    }
    wasCompleted.current = progress.completed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.completed]);

  const hideSplash = useCallback(async () => {
    if (fontsLoaded && !isLoading) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isLoading]);

  useEffect(() => {
    hideSplash();
  }, [hideSplash]);

  if (!fontsLoaded || isLoading) {
    return null;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={theme.bg === "#121213" ? "light-content" : "dark-content"} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <SoundToggle enabled={sound.enabled} onToggle={sound.toggle} />
            <View style={styles.headerTitles}>
              <Text style={[styles.title, { color: theme.fg }]}>WordInk</Text>
              <PuzzleNav
                date={date}
                puzzleNumber={puzzleNumber}
                isToday={isToday}
                canGoToPrevious={canGoToPrevious}
                canGoToNext={canGoToNext}
                onPrevious={goToPrevious}
                onNext={goToNext}
                onToday={goToToday}
              />
            </View>
            <IconButton accessibilityLabel="How to play" onPress={() => setShowInstructions(true)}>
              <Text style={[styles.helpIcon, { color: theme.fg }]}>?</Text>
            </IconButton>
          </View>

          <DropDisplay drop={drop} />
          <GuessLog
            acceptedWords={progress.acceptedWords}
            onSelectWord={(word) => setPrefill({ word, token: Date.now() })}
          />

          {!progress.completed && (
            <SubmitForm
              drop={drop}
              disabled={progress.completed}
              feedback={feedback}
              prefill={prefill}
              onSubmit={submitWord}
            />
          )}
          <FeedbackRegion feedback={feedback} />

          {!progress.completed && !isToday && (
            <Text style={[styles.archiveNote, { color: theme.fgMuted }]}>
              You're playing an old puzzle — this is just for fun and won't affect your streak.
            </Text>
          )}

          {!progress.completed && progress.acceptedWords.length > 0 && (
            <LockInButton onLockIn={lockIn} />
          )}

          {!progress.completed && <StreakDisplay streak={streak} />}

          {progress.completed && (
            <ResultsPanel drop={drop} words={progress.acceptedWords} streak={streak} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <InstructionsModal open={showInstructions} onClose={() => setShowInstructions(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingBottom: 48,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    borderBottomWidth: 1,
    marginBottom: 26,
  },
  headerTitles: {
    flex: 1,
    alignItems: "center",
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 30,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  helpIcon: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
  },
  archiveNote: {
    fontFamily: fonts.body,
    marginTop: -6,
    marginBottom: 14,
    fontSize: 13,
    textAlign: "center",
  },
});

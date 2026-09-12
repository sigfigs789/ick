import * as Haptics from 'expo-haptics';
import { isEliteRarity, isWinningRarity } from '../../../src/game/rank';
import type { Rarity } from '../../../src/game/types';

/**
 * The reply to a submission, in the channel a phone actually has.
 *
 * The website answers with sound: `src/audio/sound.ts` synthesises a rising
 * chime whose pitch climbs with the rarity, a short buzz for a rejection, and
 * an arpeggio on a good word. None of it is a file -- it is oscillators, and
 * the Web Audio API is not something React Native has.
 *
 * Haptics rather than bundled audio, and not only because the sound was
 * synthesised. A phone is the one device where sound is usually the wrong
 * answer: most of them are on silent, a game played on a bus should not
 * announce itself, and iOS would route a chime through whatever the player is
 * listening to. Touch is the channel that works in all three cases, and it is
 * the one a player already reads as "the app answered".
 *
 * What survives the translation is the shape: the reply gets stronger as the
 * word gets rarer, so the feel still tells the player how they did before they
 * have read the badge. What does not survive is the pitch ladder -- a phone
 * has three impact weights, not nine -- so the nine tiers collapse onto the two
 * thresholds the game already treats as meaningful (`rank.ts`): Rare and up is
 * a win, Extremely Rare and up is elite.
 *
 * Every call is best-effort. A device with no haptic engine, or a player who
 * has turned system haptics off, rejects these quietly -- and a word must never
 * fail to be accepted because the buzz could not be delivered.
 */

function safely(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => {});
  } catch {
    // Nothing about a guess depends on the phone agreeing to buzz.
  }
}

/** An accepted word, weighted by how good it is. */
export function signalAccept(rarity: Rarity): void {
  if (isEliteRarity(rarity)) {
    safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    return;
  }
  const weight = isWinningRarity(rarity)
    ? Haptics.ImpactFeedbackStyle.Medium
    : Haptics.ImpactFeedbackStyle.Light;
  safely(() => Haptics.impactAsync(weight));
}

/**
 * A rejection: the lightest thing the API has.
 *
 * Deliberately not the system's "error" notification, which is a triple buzz
 * that lands as a telling-off. The website's own buzz is described in its
 * source as unobtrusive rather than punishing, and rejections here are free
 * and unlimited -- being wrong is how the game is played, so it should barely
 * register.
 */
export function signalReject(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** The celebration, for a first winning word. */
export function signalCelebrate(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** A plain tap, for controls whose effect is not otherwise felt. */
export function signalTap(): void {
  safely(() => Haptics.selectionAsync());
}

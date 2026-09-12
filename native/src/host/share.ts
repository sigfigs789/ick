import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Getting a result out of the app.
 *
 * The website has two buttons because a browser gives it two bad options: the
 * Web Share API is missing on desktop, so "Share" there means "copy to
 * clipboard and hope", and posting to X needs its own intent URL.
 *
 * A phone has the real thing. The system share sheet already lists every
 * destination the player has -- Messages, X, Reddit, a group chat, the
 * clipboard -- chosen by them rather than by us, and it is the gesture they
 * already know. So the two buttons become one, and the X button is gone: it
 * was a shortcut past a sheet that no longer needs shortcutting.
 *
 * Copy stays as a separate, smaller affordance, because copying a single
 * logged word (the tap-a-word-to-copy gesture in the guess log) is not a share
 * and should not raise a sheet.
 */

/** Raise the system share sheet. Resolves to whether the player went through with it. */
export async function shareText(text: string): Promise<boolean> {
  try {
    const result = await Share.share({ message: text });
    return result.action === Share.sharedAction;
  } catch {
    // Dismissed, or no sheet available. Either way there is nothing to report
    // and nothing about the puzzle changes.
    return false;
  }
}

/** Put text on the clipboard, for the copy affordances that are not shares. */
export async function copyText(text: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
  } catch {
    // Best-effort, exactly as on the website.
  }
}

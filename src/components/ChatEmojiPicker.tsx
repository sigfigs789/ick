import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

/**
 * The full emoji picker behind a reaction tray's "+", in its own module so the
 * picker and its emoji data load only when somebody asks for more than the
 * quick reactions (see ChatReactions.tsx).
 *
 * Native emoji rather than the picker's default image sets: those are fetched
 * from a CDN, and a reaction is shown as the character the device draws.
 */
export default function ChatEmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <EmojiPicker
      className="chat__emoji-picker"
      emojiStyle={EmojiStyle.NATIVE}
      colorScheme={Theme.AUTO}
      width="100%"
      height="100%"
      autoFocusSearch={false}
      previewConfig={{ showPreview: false }}
      labels={{ searchPlaceholder: "Search emoji" }}
      onEmojiClick={(data) => onPick(data.emoji)}
    />
  );
}

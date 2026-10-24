import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CHAT_MAX_LENGTH,
  QUICK_REACTIONS,
  chatProblem,
  normaliseMessage,
  toggled,
  type ChatProblem,
  type Reaction,
} from '../../../src/game/chat';
import {
  CHAT_RULES,
  REPORT_RESULT_TEXT,
  acceptChatTerms,
  blockHandle,
  blockedHandles,
  canModerate,
  hasAcceptedChatTerms,
  moderated,
  reportLine,
  reportedLines,
  unblockAll,
} from '../../../src/game/chatModeration';
import { CHAT_PRIVATE_EVENT, onBankedNotice, privateNotices } from '../../../src/game/chatNotices';
import {
  byLine,
  loadSeen,
  merge,
  newestId,
  noticeIcon,
  saveSeen,
  timeOf,
  type ChatMessage,
  type Reactions,
} from '../../../src/game/chatRoom';
import { addDays, formatDateLabel, todayDateString } from '../../../src/game/date';
import { dropForDate, FIRST_PUZZLE } from '../../../src/game/drop';
import { handleFor } from '../../../src/game/handle';
import { loadPlayerId } from '../../../src/game/player';
import { onViewedPuzzle, viewedPuzzle } from '../../../src/game/viewedPuzzle';
import { signalTap } from '../host/feedback';
import { useAppState } from '../hooks/useAppState';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** How often an open room asks for new lines; the website's CHAT_POLL_MS. */
const POLL_MS = 4000;
/** How often the closed chat checks for an unread line; the website's CHAT_CHECK_MS. */
const CHECK_MS = 30_000;

const TERMS_URL = 'https://www.wordink.app/terms.html';

const PROBLEM_TEXT: Record<ChatProblem | 'rate-limited' | 'banned' | 'unavailable', string> = {
  empty: '',
  'too-long': `Keep it under ${CHAT_MAX_LENGTH} characters.`,
  profane: "Let's keep it clean. Try saying that another way.",
  'rate-limited': 'Slow down a little. Try again in a few seconds.',
  banned: "You've been removed from the chat for breaking its rules.",
  unavailable: "Couldn't send. Try again in a moment.",
};

/** Every room read since launch, so stepping back to one shows it at once. */
const rooms = new Map<string, { messages: ChatMessage[]; lastId: number; reactions: Reactions }>();

/**
 * Whether the room of the puzzle the game is on has a line this device has not
 * had on screen, checked every half minute while the chat is closed and the app
 * is in front. A failed check changes nothing: the dot is a nicety.
 */
export function useChatUnread(open: boolean): boolean {
  const [unread, setUnread] = useState(false);
  const [room, setRoom] = useState(viewedPuzzle);
  useEffect(() => onViewedPuzzle(setRoom), []);

  useEffect(() => {
    if (open) return;
    let cancelled = false;
    const check = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const response = await fetch(`/api/chat?date=${room}&latest=1`);
        if (!response.ok) return;
        const data = (await response.json()) as { latest?: unknown };
        if (cancelled || typeof data.latest !== 'number') return;
        const seen = loadSeen()[room] ?? 0;
        setUnread(data.latest > seen || newestId(privateNotices(room)) > seen);
      } catch {
        // Offline: leave the dot as it is.
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, room]);

  // Opening the chat reads it; the next check after it closes says afresh.
  return !open && unread;
}

/** The header's chat button: a speech bubble, dotted when something is unread. */
export function ChatButton({ unread, onPress }: { unread: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unread ? 'Open chat, new messages' : 'Open chat'}
      hitSlop={space.md}
      style={({ pressed }) => [
        styles.headerButton,
        { backgroundColor: theme.bgInset, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={styles.headerGlyph}>💬</Text>
      {unread && <View style={[styles.dot, { backgroundColor: theme.rarity.Rare.dot, borderColor: theme.bg }]} />}
    </Pressable>
  );
}

/**
 * The chat: a room of short messages per puzzle, the same rooms the website's
 * bubble shows (src/components/ChatBubble.tsx), read through the same
 * api/chat.ts.
 *
 * Opened for the first time, it asks the player to agree to the room's rules
 * before showing anything -- the App Store's condition for an app that shows
 * what players write. Holding a line opens its reactions, and on another
 * player's message Report and Block (see src/game/chatModeration.ts).
 */
export function ChatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [accepted, setAccepted] = useState(hasAcceptedChatTerms);

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.fill, { backgroundColor: theme.bg, paddingBottom: insets.bottom }]}>
        {accepted ? (
          <Room onClose={onClose} />
        ) : (
          <Terms
            onAgree={() => {
              acceptChatTerms();
              setAccepted(true);
            }}
            onClose={onClose}
          />
        )}
      </View>
    </Modal>
  );
}

function Terms({ onAgree, onClose }: { onAgree: () => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.terms}>
      <Text style={[styles.termsTitle, { color: theme.fg }]} accessibilityRole="header">
        Chat rules
      </Text>
      <Text style={[styles.termsLead, { color: theme.fgMuted }]}>
        Everyone playing today's drop shares this chat. Before you join:
      </Text>
      {CHAT_RULES.map((rule) => (
        <View key={rule} style={styles.rule}>
          <Text style={[styles.ruleBullet, { color: theme.fgMuted }]}>•</Text>
          <Text style={[styles.ruleText, { color: theme.fg }]}>{rule}</Text>
        </View>
      ))}
      <Text style={[styles.termsLead, { color: theme.fgMuted }]}>
        There is no tolerance for objectionable content or abusive players. By joining you agree
        to these rules and the{' '}
        <Text
          style={{ color: theme.fg, textDecorationLine: 'underline' }}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(TERMS_URL)}
        >
          terms of use
        </Text>
        .
      </Text>
      <Pressable
        onPress={onAgree}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.primaryLabel, { color: theme.accentFg }]}>Agree and join</Text>
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" style={styles.secondary}>
        <Text style={[styles.secondaryLabel, { color: theme.fgMuted }]}>Not now</Text>
      </Pressable>
    </View>
  );
}

function Room({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const [date, setDate] = useState(viewedPuzzle);
  const [messages, setMessages] = useState<ChatMessage[]>(() => rooms.get(date)?.messages ?? []);
  const [reactions, setReactions] = useState<Reactions>(() => rooms.get(date)?.reactions ?? {});
  const [privates, setPrivates] = useState(() => privateNotices(date));
  const [loaded, setLoaded] = useState(() => rooms.has(date));
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  /** The line whose actions are open. */
  const [selected, setSelected] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(blockedHandles);
  const [reported, setReported] = useState(reportedLines);

  const lastId = useRef(rooms.get(date)?.lastId ?? 0);
  /** The room `messages` belongs to, so an answer for another one is dropped. */
  const shownDate = useRef(date);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const playerId = loadPlayerId();
  const ownHandle = playerId ? handleFor(playerId) : null;
  const today = todayDateString();

  const shown = moderated(merge(messages, privates), blocked, reported);

  // Another puzzle is another room.
  useEffect(() => {
    if (shownDate.current === date) return;
    shownDate.current = date;
    const kept = rooms.get(date);
    lastId.current = kept?.lastId ?? 0;
    setMessages(kept?.messages ?? []);
    setReactions(kept?.reactions ?? {});
    setPrivates(privateNotices(date));
    setLoaded(kept !== undefined);
    setLoadFailed(false);
    setSelected(null);
  }, [date]);

  useEffect(() => {
    const reload = () => setPrivates(privateNotices(date));
    window.addEventListener(CHAT_PRIVATE_EVENT, reload);
    return () => window.removeEventListener(CHAT_PRIVATE_EVENT, reload);
  }, [date]);

  /** Merge lines into the room; only a poll's answer moves the cursor (see ChatBubble's `show`). */
  const show = useCallback((room: string, incoming: ChatMessage[], polled = false) => {
    if (room !== shownDate.current) return;
    if (polled) for (const m of incoming) lastId.current = Math.max(lastId.current, m.id);
    setMessages((current) => {
      const next = merge(current, incoming);
      rooms.set(room, { messages: next, lastId: lastId.current, reactions: rooms.get(room)?.reactions ?? {} });
      return next;
    });
  }, []);

  const showReactions = useCallback((room: string, next: Reactions) => {
    if (room !== shownDate.current) return;
    setReactions(next);
    const kept = rooms.get(room);
    if (kept) rooms.set(room, { ...kept, reactions: next });
  }, []);

  const poll = useCallback(async () => {
    const room = date;
    try {
      const response = await fetch(`/api/chat?date=${room}&after=${lastId.current}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { messages?: ChatMessage[]; reactions?: unknown };
      if (room !== shownDate.current) return;
      show(room, data.messages ?? [], true);
      const found = byLine(data.reactions);
      if (found) showReactions(room, found);
      setLoadFailed(false);
    } catch {
      if (room === shownDate.current) setLoadFailed(true);
    } finally {
      if (room === shownDate.current) setLoaded(true);
    }
  }, [date, show, showReactions]);

  // Poll while the app is in front.
  const [active, setActive] = useState(AppState.currentState === 'active');
  useAppState({ onForeground: () => setActive(true), onBackground: () => setActive(false) });
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, poll]);

  // A word this player just banked earned a notice: show it now.
  useEffect(() => onBankedNotice((room, posted) => show(room, [posted])), [show]);

  // Everything on screen counts as read.
  useEffect(() => {
    const read = Math.max(newestId(messages), newestId(privates));
    if (read > 0 && shownDate.current === date) saveSeen(date, read);
  }, [messages, privates, date]);

  async function send() {
    if (sending || !playerId) return;
    const body = normaliseMessage(draft);
    const problem = chatProblem(body);
    if (problem) {
      setNotice(PROBLEM_TEXT[problem]);
      return;
    }
    setSending(true);
    setNotice('');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, body, date }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: ChatMessage; reason?: string };
      if (response.ok && data.message) {
        show(date, [data.message]);
        setDraft('');
      } else if (
        data.reason === 'profane' ||
        data.reason === 'too-long' ||
        data.reason === 'rate-limited' ||
        data.reason === 'banned'
      ) {
        setNotice(PROBLEM_TEXT[data.reason]);
      } else {
        setNotice(PROBLEM_TEXT.unavailable);
      }
    } catch {
      setNotice(PROBLEM_TEXT.unavailable);
    } finally {
      setSending(false);
    }
  }

  async function react(id: number, emoji: string) {
    setSelected(null);
    if (!playerId || !ownHandle) return;
    const room = date;
    const before = reactions[id] ?? [];
    const on = !before.some((r) => r.emoji === emoji && r.handles.includes(ownHandle));
    signalTap();
    showReactions(room, { ...reactions, [id]: toggled(before, emoji, ownHandle, on) });
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, date: room, react: { id, emoji, on } }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setReactions((current) => ({ ...current, [id]: before }));
      setNotice("Couldn't react. Try again in a moment.");
    }
  }

  function report(message: ChatMessage) {
    setSelected(null);
    if (!playerId) return;
    Alert.alert('Report this message?', 'It will be hidden for you and sent to us for review.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () => {
          const pending = reportLine(playerId, date, message.id);
          setReported(reportedLines());
          void pending.then((result) => {
            setNotice(REPORT_RESULT_TEXT[result]);
            setReported(reportedLines());
          });
        },
      },
    ]);
  }

  function block(message: ChatMessage) {
    setSelected(null);
    Alert.alert(`Block ${message.handle}?`, "You won't see their messages in any chat.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          blockHandle(message.handle);
          setBlocked(blockedHandles());
          setNotice(`Blocked ${message.handle}.`);
        },
      },
    ]);
  }

  const step = (by: number) => {
    signalTap();
    setDate(addDays(date, by));
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.roomHeader, { borderBottomColor: theme.border }]}>
        <StepButton label="‹" accessibilityLabel="Previous puzzle's chat" disabled={date <= FIRST_PUZZLE} onPress={() => step(-1)} />
        <View style={styles.roomTitle}>
          <Text style={[styles.drop, { color: theme.fg }]} accessibilityRole="header">
            {dropForDate(date)}
          </Text>
          <Text style={[styles.dateLabel, { color: theme.fgFaint }]}>{formatDateLabel(date)}</Text>
        </View>
        <StepButton label="›" accessibilityLabel="Next puzzle's chat" disabled={date >= today} onPress={() => step(1)} />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close chat"
          hitSlop={space.md}
          style={({ pressed }) => [styles.headerButton, { backgroundColor: theme.bgInset, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.closeGlyph, { color: theme.fg }]}>✕</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={shown}
        keyExtractor={(m) => String(m.id)}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.fgFaint }]}>
            {!loaded ? 'Loading…' : loadFailed ? "Couldn't load the chat." : 'No messages yet. Say hello!'}
          </Text>
        }
        ListFooterComponent={
          blocked.size > 0 ? (
            <Text style={[styles.blocked, { color: theme.fgFaint }]}>
              {blocked.size === 1 ? '1 player blocked' : `${blocked.size} players blocked`} ·{' '}
              <Text
                style={{ color: theme.fgMuted, fontWeight: '700' }}
                accessibilityRole="button"
                onPress={() => {
                  unblockAll();
                  setBlocked(blockedHandles());
                  setNotice('');
                }}
              >
                Unblock
              </Text>
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Line
            message={item}
            own={item.handle === ownHandle}
            ownHandle={ownHandle}
            reactions={reactions[item.id] ?? []}
            selected={selected === item.id}
            onHold={() => {
              if (!ownHandle || item.kind === 'earlier') return;
              signalTap();
              setSelected((current) => (current === item.id ? null : item.id));
            }}
            onReact={(emoji) => void react(item.id, emoji)}
            onReport={canModerate(item, ownHandle) ? () => report(item) : undefined}
            onBlock={canModerate(item, ownHandle) ? () => block(item) : undefined}
          />
        )}
      />

      {notice !== '' && (
        <Text style={[styles.notice, { color: theme.fgMuted }]} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
      <View style={[styles.form, { borderTopColor: theme.border }]}>
        <TextInput
          style={[styles.input, { color: theme.fg, backgroundColor: theme.bgInset }]}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (notice) setNotice('');
          }}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={ownHandle ? `Say something as ${ownHandle}…` : 'Chat is unavailable'}
          placeholderTextColor={theme.fgFaint}
          editable={!!playerId}
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          submitBehavior="submit"
          accessibilityLabel="Message"
        />
        <Pressable
          onPress={() => void send()}
          disabled={!playerId || sending || draft.trim() === ''}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: theme.accent,
              opacity: !playerId || sending || draft.trim() === '' ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.sendLabel, { color: theme.accentFg }]}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function StepButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={space.sm}
      style={({ pressed }) => [styles.step, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.stepGlyph, { color: theme.fg }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One line: a player's message or a notice, with its reactions under it.
 * Holding it opens the quick reactions and, on another player's message,
 * Report and Block.
 */
function Line({
  message,
  own,
  ownHandle,
  reactions,
  selected,
  onHold,
  onReact,
  onReport,
  onBlock,
}: {
  message: ChatMessage;
  own: boolean;
  ownHandle: string | null;
  reactions: Reaction[];
  selected: boolean;
  onHold: () => void;
  onReact: (emoji: string) => void;
  onReport?: () => void;
  onBlock?: () => void;
}) {
  const theme = useTheme();
  const tier = message.tier === 'Mythic' || message.tier === 'Legend' ? theme.rarity[message.tier] : null;
  const canReact = ownHandle !== null && message.kind !== 'earlier';

  return (
    <Pressable
      onLongPress={onHold}
      delayLongPress={350}
      accessibilityHint={canReact ? 'Hold for reactions, report and block' : undefined}
      style={[
        styles.line,
        message.kind && {
          backgroundColor: tier?.bg ?? theme.bgInset,
          borderRadius: radius.md,
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
        },
        selected && { backgroundColor: theme.bgInset, borderRadius: radius.md },
      ]}
    >
      {message.kind ? (
        <>
          <Text style={[styles.body, styles.noticeBody, { color: tier?.fg ?? theme.fg }]}>
            {noticeIcon({ ...message, kind: message.kind })} <NoticeBody message={message} />
          </Text>
          <Text style={[styles.time, { color: tier?.fg ?? theme.fgFaint, opacity: 0.75 }]}>
            {timeOf(message.at)}
            {message.kind === 'earlier' ? ' · Only you can see this' : ''}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.meta}>
            <Text style={[styles.handle, { color: own ? theme.fg : theme.fgMuted }]}>{message.handle}</Text>
            <Text style={[styles.time, { color: theme.fgFaint }]}>  {timeOf(message.at)}</Text>
          </Text>
          <Text style={[styles.body, { color: theme.fg }]}>{message.body}</Text>
        </>
      )}

      {reactions.length > 0 && (
        <View style={styles.chips}>
          {reactions.map(({ emoji, handles }) => {
            const mine = ownHandle !== null && handles.includes(ownHandle);
            return (
              <Pressable
                key={emoji}
                onPress={() => onReact(emoji)}
                disabled={!canReact}
                accessibilityRole="button"
                accessibilityState={{ selected: mine }}
                accessibilityLabel={`${emoji} ${handles.length}`}
                style={[
                  styles.chip,
                  {
                    borderColor: mine ? theme.fgMuted : theme.border,
                    backgroundColor: mine ? theme.bgInset : 'transparent',
                  },
                ]}
              >
                <Text style={styles.chipEmoji}>{emoji}</Text>
                <Text style={[styles.chipCount, { color: theme.fgMuted }]}>{handles.length}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {selected && (
        <View style={styles.actions}>
          <View style={[styles.tray, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onReact(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
                style={({ pressed }) => [styles.trayEmoji, pressed && { backgroundColor: theme.bgInset }]}
              >
                <Text style={styles.trayEmojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          {onReport && onBlock && (
            <View style={styles.moderate}>
              <ActionButton label="Report" onPress={onReport} />
              <ActionButton label={`Block ${message.handle}`} onPress={onBlock} />
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { borderColor: theme.border, backgroundColor: pressed ? theme.bgInset : 'transparent' },
      ]}
    >
      <Text style={[styles.actionLabel, { color: theme.dangerFg }]}>{label}</Text>
    </Pressable>
  );
}

/** A notice's body with its word in bold, the way the website marks it. */
function NoticeBody({ message }: { message: ChatMessage }) {
  const { body, word } = message;
  if (!word || !/^[a-z]+$/.test(word)) return <>{body}</>;
  const at = body.lastIndexOf(word);
  if (at < 0) return <>{body}</>;
  return (
    <>
      {body.slice(0, at)}
      <Text style={{ fontWeight: '800', fontStyle: message.mode === 'freeform' ? 'italic' : 'normal' }}>
        {word}
      </Text>
      {body.slice(at + word.length)}
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  headerButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyph: {
    fontSize: 15,
  },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  closeGlyph: {
    fontSize: 14,
    fontWeight: '700',
  },
  terms: {
    flex: 1,
    padding: space.lg,
    paddingTop: space.lg * 2,
    gap: space.md,
  },
  termsTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  termsLead: {
    fontSize: 15,
    lineHeight: 21,
  },
  rule: {
    flexDirection: 'row',
    gap: space.sm,
  },
  ruleBullet: {
    fontSize: 15,
    lineHeight: 21,
  },
  ruleText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  primary: {
    marginTop: space.md,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '800',
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  roomTitle: {
    flex: 1,
    alignItems: 'center',
  },
  drop: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  dateLabel: {
    fontSize: 12,
  },
  step: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontSize: 26,
    fontWeight: '600',
  },
  list: {
    flexGrow: 1,
    padding: space.lg,
    gap: space.sm,
  },
  empty: {
    margin: 'auto',
    textAlign: 'center',
    fontSize: 15,
  },
  blocked: {
    marginTop: space.md,
    textAlign: 'center',
    fontSize: 13,
  },
  line: {
    gap: 2,
  },
  meta: {
    fontSize: 13,
  },
  handle: {
    fontWeight: '700',
    fontSize: 13,
  },
  time: {
    fontSize: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
  },
  noticeBody: {
    fontSize: 14,
    lineHeight: 19,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    gap: space.sm,
    marginTop: space.xs,
  },
  tray: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  trayEmoji: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayEmojiText: {
    fontSize: 22,
  },
  moderate: {
    flexDirection: 'row',
    gap: space.sm,
  },
  action: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 1,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  notice: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
    fontSize: 13,
  },
  form: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: Platform.OS === 'ios' ? space.sm + 2 : space.xs,
    fontSize: 16,
  },
  send: {
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  sendLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
});

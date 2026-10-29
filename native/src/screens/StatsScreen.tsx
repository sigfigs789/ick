import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ACHIEVEMENT_GROUPS,
  earnedShareLabel,
  fetchAchievementRates,
  recentAchievements,
  syncAchievements,
  type AchievementStatus,
} from '../../../src/game/achievements';
import { formatDateLabel, todayDateString } from '../../../src/game/date';
import { formatTotal } from '../../../src/game/dictionary';
import { MODE_LABELS } from '../../../src/game/mode';
import { CURRENT_TIERS, loadStats, TOP_WORDS, type PlayerStats, type StatWord } from '../../../src/game/stats';
import { loadStreak } from '../../../src/game/storage';
import type { Rarity } from '../../../src/game/types';
import { PAGE_GUTTER, PageHead, PageNote } from '../components/PageChrome';
import { RarityBadge } from '../components/RarityBadge';
import { Sheet } from '../components/Sheet';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { rarityPalette, useTheme } from '../theme/useTheme';

/**
 * The player's own page: their numbers, then their achievements.
 *
 * A port of the website's StatsPage, drawn as src/index.css draws it. One page
 * rather than two, because most achievements are a number on the first half
 * crossing a line -- the two halves are the same record read two ways.
 *
 * Read once when the screen opens, from this device (see game/stats.ts and
 * game/achievements.ts), and opening it is also what keeps a newly earned
 * badge: `syncAchievements` stamps the day an achievement was first seen
 * earned. The screen remounts each time its tab is chosen, so a visit after a
 * puzzle reads the puzzle.
 */
export function StatsScreen({ onPlay }: { onPlay?: () => void } = {}) {
  const theme = useTheme();
  const [{ stats, achievements }] = useState(() => {
    const streak = loadStreak();
    return { stats: loadStats(streak), achievements: syncAchievements(streak) };
  });
  // The share under each badge starts from the bundled snapshot and redraws
  // once the live counts arrive (see fetchAchievementRates).
  const [, setLiveRates] = useState(false);
  useEffect(() => {
    void fetchAchievementRates().then((rates) => rates && setLiveRates(true));
  }, []);

  if (stats.wordsFound === 0) {
    return (
      <ScrollView style={styles.fill} contentContainerStyle={styles.page}>
        <PageHead title="Your stats" />
        <Text style={[styles.empty, { color: theme.fgMuted }]}>
          Nothing here yet. Bank a word and your numbers start.
          {onPlay && (
            <>
              {' '}
              <Text
                onPress={() => {
                  signalTap();
                  onPlay();
                }}
                accessibilityRole="link"
                style={[styles.link, { color: theme.fg }]}
              >
                Play today’s puzzle
              </Text>
            </>
          )}
        </Text>
        {/* Every badge still waiting, so there is something to aim for. */}
        <Achievements statuses={achievements} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.page}>
      <PageHead title="Your stats">
        <PageNote>From your play on this device.</PageNote>
      </PageHead>
      <Headline stats={stats} />
      <RarityBars byRarity={stats.byRarity} />
      <BestWords stats={stats} />
      <ByMode stats={stats} />
      <Achievements statuses={achievements} />
    </ScrollView>
  );
}

/** A section's heading (`.stats__heading`), with an optional note beside it. */
function Heading({ children, note }: { children: string; note?: string }) {
  const theme = useTheme();
  return (
    <Text style={[styles.heading, { color: theme.fg }]} accessibilityRole="header">
      {children.toUpperCase()}
      {note && (
        <Text style={[styles.headingNote, { color: theme.fgFaint }]}>
          {'  '}
          {note}
        </Text>
      )}
    </Text>
  );
}

/** Six tiles, three to a row: the numbers a player looks for first. */
function Headline({ stats }: { stats: PlayerStats }) {
  const theme = useTheme();
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: 'Current streak', value: String(stats.currentStreak), note: 'days' },
    { label: 'Longest streak', value: String(stats.longestStreak), note: 'days' },
    { label: 'Days played', value: String(stats.daysPlayed) },
    { label: 'Words found', value: String(stats.wordsFound) },
    { label: 'Puzzles finished', value: String(stats.finished) },
    {
      label: 'Longest word',
      value: stats.longestWord ? String(stats.longestWord.word.length) : '–',
      note: stats.longestWord?.word,
    },
  ];
  return (
    <View style={styles.tiles} accessibilityLabel="Headline numbers">
      {tiles.map((tile) => (
        <View
          key={tile.label}
          style={[styles.tile, { borderColor: theme.border, backgroundColor: theme.cardBg }]}
          accessible
          accessibilityLabel={`${tile.label}: ${tile.value}${tile.note ? ` ${tile.note}` : ''}`}
        >
          <Text style={[styles.tileLabel, { color: theme.fgMuted }]}>{tile.label}</Text>
          <Text style={[styles.tileValue, { color: theme.fg }]}>{tile.value}</Text>
          {tile.note && (
            <Text style={[styles.tileNote, { color: theme.fgFaint }]} numberOfLines={1}>
              {tile.note}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

/** One bar per tier, in the tier's own dot colour, against the most-found tier. */
function RarityBars({ byRarity }: { byRarity: PlayerStats['byRarity'] }) {
  const theme = useTheme();
  // Quotidian only where an old puzzle reached it.
  const tiers: Rarity[] = byRarity.Quotidian ? [...CURRENT_TIERS, 'Quotidian'] : [...CURRENT_TIERS];
  const most = Math.max(1, ...tiers.map((tier) => byRarity[tier] ?? 0));
  return (
    <View style={styles.section}>
      <Heading>Words by rarity</Heading>
      <View style={styles.bars}>
        {tiers.map((tier) => {
          const count = byRarity[tier] ?? 0;
          // The badge's own palette paints the bar, so the bars match the
          // badges -- except Legend, whose dot is white on its black badge and
          // would vanish against the track; it takes the text colour instead.
          const fill = tier === 'Legend' ? theme.fg : rarityPalette(theme, tier).dot;
          return (
            <View key={tier} style={styles.barRow} accessible accessibilityLabel={`${tier}: ${count}`}>
              <Text style={[styles.barLabel, { color: theme.fgMuted }]}>{tier}</Text>
              <View style={[styles.barTrack, { backgroundColor: theme.bgInset }]}>
                <View style={[styles.barFill, { width: `${(count / most) * 100}%`, backgroundColor: fill }]} />
              </View>
              <Text style={[styles.barCount, { color: theme.fg }]}>{count}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The rarest finds, newest first on a tie, with the day they were found. */
function BestWords({ stats }: { stats: PlayerStats }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(SHEET_BATCH);
  // Empty when every word found was on a legacy-scored puzzle (see game/stats.ts).
  if (stats.topWords.length === 0) return null;
  const total = stats.topWords.length;
  return (
    <View style={styles.section}>
      <Heading>Best words</Heading>
      <BestWordList words={stats.topWords.slice(0, TOP_WORDS)} />
      {total > TOP_WORDS && (
        <View style={styles.more}>
          <Text
            onPress={() => {
              signalTap();
              setShown(SHEET_BATCH);
              setOpen(true);
            }}
            accessibilityRole="button"
            style={[styles.link, styles.moreLink, { color: theme.fg }]}
          >
            Show more
          </Text>
          <Text style={[styles.moreCount, { color: theme.fgFaint }]}>
            {TOP_WORDS} of {total}
          </Text>
        </View>
      )}
      {/* Every best word, a batch at a time: a long record runs to thousands
          of rows, each with a badge, so the sheet adds the next batch as the
          reader nears the bottom. */}
      <Sheet
        open={open}
        title="Best words"
        onClose={() => setOpen(false)}
        onNearEnd={() => setShown((n) => Math.min(total, n + SHEET_BATCH))}
      >
        <BestWordList words={stats.topWords.slice(0, shown)} />
      </Sheet>
    </View>
  );
}

/** How many more rows the Show more sheet renders each time the reader nears the bottom. */
const SHEET_BATCH = 30;

function BestWordList({ words }: { words: StatWord[] }) {
  const theme = useTheme();
  return (
    <View>
      {words.map((word) => (
        <View key={`${word.word}-${word.date}`} style={[styles.word, { borderBottomColor: theme.border }]}>
          <View style={styles.wordText}>
            <Text style={[styles.wordName, { color: theme.fg }]}>{word.word}</Text>
            <Text style={[styles.wordDate, { color: theme.fgFaint }]}>
              {formatDateLabel(word.date)}
              {word.mode === 'freeform' ? ` · ${MODE_LABELS.freeform}` : ''}
            </Text>
          </View>
          <RarityBadge rarity={word.rarity} zipf={word.zipf} date={word.date} />
        </View>
      ))}
    </View>
  );
}

/** Each mode's finished puzzles, their average daily total and their best. */
function ByMode({ stats }: { stats: PlayerStats }) {
  const theme = useTheme();
  const cell = (text: string, first = false, head = false) => (
    <Text
      style={[
        styles.cell,
        first ? styles.cellFirst : styles.cellNumber,
        head ? [styles.cellHead, { color: theme.fgMuted }] : { color: theme.fg },
        first && !head && styles.cellRowHead,
      ]}
    >
      {text}
    </Text>
  );
  return (
    <View style={styles.section}>
      <Heading>By mode</Heading>
      <View style={[styles.tableRow, { borderBottomColor: theme.border }]}>
        {cell('Mode', true, true)}
        {cell('Puzzles', false, true)}
        {cell('Average', false, true)}
        {cell('Best', false, true)}
      </View>
      {stats.modes.map((row) => (
        <View
          key={row.mode}
          style={[styles.tableRow, { borderBottomColor: theme.border }]}
          accessible
          accessibilityLabel={`${MODE_LABELS[row.mode]}: ${row.puzzles} puzzles, average ${
            row.average === null ? 'none' : formatTotal(row.average)
          }, best ${row.best === null ? 'none' : formatTotal(row.best)}`}
        >
          {cell(MODE_LABELS[row.mode], true)}
          {cell(String(row.puzzles))}
          {cell(row.average === null ? '–' : formatTotal(row.average))}
          {cell(row.best === null ? '–' : formatTotal(row.best))}
        </View>
      ))}
      <Text style={[styles.footnote, { color: theme.fgFaint }]}>
        Average and best are daily totals of finished puzzles.
      </Text>
    </View>
  );
}

/**
 * Every achievement, by group: earned ones raised, the rest dashed and grey.
 * The latest earned come first under Recent, and again in their own group.
 */
function Achievements({ statuses }: { statuses: AchievementStatus[] }) {
  const theme = useTheme();
  const earned = statuses.filter((status) => status.earnedOn).length;
  const completed = Math.round((100 * earned) / statuses.length);
  return (
    <View style={styles.section}>
      <Heading note={`${earned} of ${statuses.length} · ${completed}% completed`}>Achievements</Heading>
      {[
        { group: 'Recent', inGroup: recentAchievements(statuses, todayDateString()) },
        ...ACHIEVEMENT_GROUPS.map((group) => ({
          group,
          inGroup: statuses.filter((status) => status.achievement.group === group),
        })),
      ]
        // A group can be empty on a host that leaves its badges off (see
        // `viaSuggestions` in game/achievements.ts).
        .filter(({ inGroup }) => inGroup.length > 0)
        .map(({ group, inGroup }, index) => (
          <View key={group} style={index > 0 && styles.groupGap}>
            <Text style={[styles.groupHeading, { color: theme.fgMuted }]} accessibilityRole="header">
              {group}
            </Text>
            <View style={styles.achievements}>
              {inGroup.map((status) => (
                <AchievementCard status={status} key={status.achievement.id} />
              ))}
            </View>
          </View>
        ))}
    </View>
  );
}

function AchievementCard({ status }: { status: AchievementStatus }) {
  const theme = useTheme();
  const { achievement, earnedOn, progress, word } = status;
  const meta = earnedOn
    ? `Earned ${formatDateLabel(earnedOn)}${word ? ` with ${word}` : ''}`
    : progress
      ? `${progress.current} / ${progress.target}`
      : 'Locked';
  const share = earnedShareLabel(achievement.id);
  return (
    <View
      style={[
        styles.achievement,
        earnedOn
          ? [styles.achievementEarned, { borderColor: theme.border, backgroundColor: theme.cardBg }]
          : { borderColor: theme.border, backgroundColor: theme.bgInset },
      ]}
      accessible
      accessibilityLabel={`${achievement.title}: ${achievement.description}. ${meta}${share ? `. ${share}` : ''}`}
    >
      {/* Greyed until earned: a filter has no React Native spelling, so a
          locked icon is simply faded. */}
      <Text style={[styles.achievementIcon, !earnedOn && styles.achievementIconLocked]}>{achievement.icon}</Text>
      <View style={styles.achievementBody}>
        <Text style={[styles.achievementTitle, { color: earnedOn ? theme.fg : theme.fgMuted }]}>
          {achievement.title}
        </Text>
        <Text style={[styles.achievementText, { color: earnedOn ? theme.fg : theme.fgMuted }]}>
          {achievement.description}
        </Text>
        <View style={styles.achievementMeta}>
          {!earnedOn && progress && (
            <View style={[styles.progress, { backgroundColor: theme.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, (progress.current / progress.target) * 100)}%`,
                    backgroundColor: theme.fgMuted,
                  },
                ]}
              />
            </View>
          )}
          <Text
            style={[
              styles.achievementMetaText,
              earnedOn ? { color: theme.successFg, fontWeight: '700' } : { color: theme.fgFaint },
            ]}
          >
            {meta}
          </Text>
        </View>
        {share && <Text style={[styles.achievementShare, { color: theme.fgFaint }]}>{share}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  page: {
    paddingHorizontal: PAGE_GUTTER,
    paddingTop: space.xl,
    paddingBottom: space.xxl * 2,
  },
  empty: {
    fontSize: 16,
    lineHeight: 23,
    marginBottom: space.xl,
  },
  link: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  /* `.stats__tiles`: three to a row. */
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 28,
  },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 0,
    gap: 2.4,
    paddingVertical: 11.2,
    paddingHorizontal: 12.8,
    borderWidth: 1,
    borderRadius: 12,
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  tileValue: {
    fontSize: 25.6,
    fontWeight: '900',
    lineHeight: 28.2,
    fontVariant: ['tabular-nums'],
  },
  tileNote: {
    fontSize: 12,
  },
  section: {
    marginBottom: 30.4,
  },
  heading: {
    marginBottom: 12,
    fontSize: 15.2,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  headingNote: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  bars: {
    gap: 6.4,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9.6,
  },
  barLabel: {
    width: 104,
    fontSize: 13.6,
    fontWeight: '700',
  },
  barTrack: {
    flex: 1,
    height: 9.6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  barCount: {
    width: 40,
    textAlign: 'right',
    fontSize: 13.6,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  word: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8.8,
    borderBottomWidth: 1,
  },
  wordText: {
    flex: 1,
    minWidth: 0,
  },
  wordName: {
    fontSize: 16,
    fontWeight: '700',
  },
  wordDate: {
    fontSize: 12,
  },
  /* `.stats__more`. */
  more: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 16,
    marginTop: 12,
  },
  moreLink: {
    fontSize: 13.6,
  },
  moreCount: {
    marginLeft: 'auto',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  cell: {
    paddingVertical: 7.2,
    paddingHorizontal: 4,
    fontSize: 13.6,
    fontVariant: ['tabular-nums'],
  },
  cellFirst: {
    flex: 1.3,
    textAlign: 'left',
  },
  cellNumber: {
    flex: 1,
    textAlign: 'right',
  },
  cellHead: {
    fontSize: 12,
    fontWeight: '700',
  },
  /* A row's mode is its `th`, which a browser sets bold. */
  cellRowHead: {
    fontWeight: '700',
  },
  footnote: {
    marginTop: 8,
    fontSize: 12,
  },
  groupGap: {
    marginTop: 16,
  },
  groupHeading: {
    marginBottom: 8,
    fontSize: 12.8,
    fontWeight: '700',
  },
  achievements: {
    gap: 8,
  },
  achievement: {
    flexDirection: 'row',
    gap: 10.4,
    paddingVertical: 10.4,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  /* `--card-shadow`, as far as a native shadow can say it. */
  achievementEarned: {
    borderStyle: 'solid',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  achievementIcon: {
    fontSize: 24,
    lineHeight: 29,
  },
  achievementIconLocked: {
    opacity: 0.45,
  },
  achievementBody: {
    flex: 1,
    minWidth: 0,
    gap: 2.4,
  },
  achievementTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  achievementText: {
    fontSize: 12.8,
    lineHeight: 18,
  },
  achievementMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6.4,
    marginTop: 2.4,
  },
  achievementMetaText: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  achievementShare: {
    fontSize: 10.9,
    fontVariant: ['tabular-nums'],
  },
  progress: {
    flex: 1,
    maxWidth: 96,
    height: 5.6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
});

import type { ImageAttachment, Message, Trust } from "@mc/protocol.ts"
import type { ChannelState } from "@mc/state.ts"
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { FlatList, Pressable, StyleSheet, View, type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native"

import { chipsFor } from "../lib/reactions"
import { threadIndex } from "../lib/thread"
import { buildRows, type Row } from "../lib/timeline"
import { useTheme } from "../theme/useTheme"
import { Text } from "../ui/Text"
import { Bubble } from "./Bubble"
import { MessageMenu } from "./MessageMenu"

export interface ConversationProps {
  messages: readonly Message[]
  state: ChannelState
  me: string
  nameOf: (name: string) => string
  group?: boolean
  revealed?: boolean
  highlight?: number | null
  receipt?: (m: Message) => string | undefined
  face?: (m: Message) => ReactNode
  onReply?: (m: Message) => void
  onReact?: (m: Message) => void
  onOpenThread?: (root: number) => void
  onOpenTask?: (task: number) => void
  onOpenImage?: (img: ImageAttachment, m: Message) => void
  loadImage?: (img: ImageAttachment) => Promise<string | null>
  contentContainerStyle?: FlatListProps<Row>["contentContainerStyle"]
}

const SHOW_PILL_AFTER = 240

const DayRow = memo(function DayRow({ label }: { label: string }) {
  return (
    <View style={styles.day}>
      <Text variant="stamp" weight="semibold" tone="ink2">
        {label}
      </Text>
    </View>
  )
})

const EventRow = memo(function EventRow({ text, task, forged, onOpenTask }: { text: string; task: number | null; forged: boolean; onOpenTask?: (task: number) => void }) {
  return (
    <View style={[styles.event, forged && styles.forged]}>
      <Text variant="stamp" tone="ink3" numberOfLines={1} style={styles.eventText}>
        {text}
      </Text>
      {task !== null && onOpenTask ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open task ${task}`} onPress={() => onOpenTask(task)}>
          <Text variant="stamp" weight="medium" tone="ink2">
            Open
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
})

export function Conversation({
  messages,
  state,
  me,
  nameOf,
  group = true,
  revealed,
  highlight = null,
  receipt,
  face,
  onReply,
  onReact,
  onOpenThread,
  onOpenTask,
  onOpenImage,
  loadImage,
  contentContainerStyle,
}: ConversationProps) {
  const theme = useTheme()
  const list = useRef<FlatList<Row>>(null)
  const [away, setAway] = useState(false)
  const [menu, setMenu] = useState<Message | null>(null)
  const [opened] = useState(() => messages.reduce((top, m) => Math.max(top, m.seq), 0))
  const threads = useMemo(() => threadIndex(messages, state, { revealed }), [messages, state, revealed])
  const rows = useMemo(() => buildRows(messages, state, { me, revealed, hide: (seq) => threads.rootOf(seq) !== null }).reverse(), [messages, state, me, revealed, threads])
  const bySeq = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const quoted = useCallback((seq: number) => bySeq.get(seq), [bySeq])
  const indexOf = useMemo(() => new Map(rows.flatMap((row, index) => (row.type === "bubble" ? [[row.m.seq, index] as const] : []))), [rows])

  const onJump = useCallback(
    (seq: number) => {
      const index = indexOf.get(seq)
      if (index !== undefined) list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
    },
    [indexOf]
  )

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAway(event.nativeEvent.contentOffset.y > SHOW_PILL_AFTER)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.type === "day") return <DayRow label={item.label} />
      if (item.type === "event")
        return <EventRow text={item.text} task={item.task} forged={state.trust.get(item.m.seq) === "forged" || state.trust.get(item.m.seq) === "refused"} onOpenTask={onOpenTask} />
      const trust: Trust | undefined = state.trust.get(item.m.seq)
      return (
        <Bubble
          m={item.m}
          me={me}
          trust={trust}
          first={item.first}
          last={item.last}
          group={group}
          adjacentReply={item.adjacentReply}
          highlighted={highlight === item.m.seq}
          fresh={item.m.seq > opened}
          receipt={receipt?.(item.m)}
          reactions={chipsFor(state, item.m.seq, me, nameOf)}
          face={face?.(item.m)}
          quoted={quoted}
          nameOf={nameOf}
          onJump={onJump}
          onReply={onReply}
          onMenu={onReply || onReact ? setMenu : undefined}
          replies={threads.replies.get(item.m.seq)?.length}
          onOpenThread={onOpenThread}
          onOpenImage={onOpenImage ? (img) => onOpenImage(img, item.m) : undefined}
          loadImage={loadImage}
        />
      )
    },
    [state, me, group, highlight, opened, receipt, face, quoted, nameOf, onJump, onReply, onReact, onOpenThread, onOpenTask, onOpenImage, loadImage, threads]
  )

  return (
    <View style={styles.fill}>
      <FlatList
        ref={list}
        testID="timeline"
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={64}
        initialNumToRender={20}
        windowSize={9}
        maxToRenderPerBatch={12}
        removeClippedSubviews
        onScrollToIndexFailed={({ index }) => list.current?.scrollToOffset({ offset: index * 80, animated: true })}
        contentContainerStyle={[styles.content, contentContainerStyle]}
      />
      {away ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to the latest message"
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          style={[styles.pill, { backgroundColor: theme.colors.raised, borderColor: theme.colors.edgeStrong }]}
        >
          <Text variant="meta" weight="medium" tone="ink2">
            ↓ Latest
          </Text>
        </Pressable>
      ) : null}
      <MessageMenu message={menu} onClose={() => setMenu(null)} onReply={onReply} onReact={onReact} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingVertical: 12 },
  day: { alignItems: "center", marginTop: 24, marginBottom: 8 },
  event: { flexDirection: "row", justifyContent: "center", alignItems: "baseline", gap: 6, paddingHorizontal: 32, paddingVertical: 3 },
  eventText: { flexShrink: 1 },
  forged: { opacity: 0.6 },
  pill: { position: "absolute", alignSelf: "center", bottom: 16, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
})

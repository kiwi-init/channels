import { Add01Icon, LockIcon } from "@hugeicons/core-free-icons"
import type { ChannelIcon } from "@mc/protocol.ts"
import { formatShort } from "@web/lib/format"
import { FlatList, Pressable, StyleSheet, View } from "react-native"

import { useTheme } from "../theme/useTheme"
import { ChannelIconTile } from "./ChannelIcon"
import { Icon } from "./Icon"
import { RobotAvatar } from "./RobotAvatar"
import { Text } from "./Text"

export interface ChannelRowView {
  code: string
  room: string
  title: string
  state: "member" | "pending" | "agents"
  agents: number
  ts: number
  recent: { from: string; text: string; byCoordinator?: boolean } | null
}

export interface RowNewsView {
  fresh: boolean
  needs: number
}

export interface ChannelListProps {
  rows: readonly ChannelRowView[]
  news: readonly RowNewsView[]
  icons?: ReadonlyMap<string, ChannelIcon>
  active?: string
  now: number
  onSelect: (code: string) => void
  onNew: () => void
}

export function rowNote(c: ChannelRowView): string {
  if (c.state === "pending") return "Waiting for the owner to let you in"
  if (c.state === "agents") return c.agents === 1 ? "One of your agents is here" : `${c.agents} of your agents are here`
  if (c.recent?.text) return c.recent.from ? `${c.recent.from}: ${c.recent.text}` : c.recent.text
  return "No messages yet"
}

function questions(n: number): string {
  return n === 1 ? "A question for you" : `${n} questions for you`
}

function Row({ c, n, icon, selected, now, onPress }: { c: ChannelRowView; n: RowNewsView | undefined; icon: ChannelIcon | null; selected: boolean; now: number; onPress: () => void }) {
  const { colors, radius } = useTheme()
  const reachable = c.state === "member"
  const needs = n?.needs ?? 0
  const fresh = !selected && !!n?.fresh
  const note = rowNote(c)
  const when = reachable ? formatShort(c.ts, now) : c.state === "pending" ? "Pending" : "Locked"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${c.title}, ${when}: ${note}${needs ? `, ${needs} for you` : fresh ? ", new messages" : ""}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderRadius: radius.card, backgroundColor: selected || pressed ? colors.pick : "transparent" }]}
    >
      <View style={reachable ? undefined : styles.dim}>
        {c.recent?.byCoordinator && reachable ? <RobotAvatar name="coordinator" size={40} label="The coordinator spoke last" /> : <ChannelIconTile icon={icon} title={c.title} size={40} />}
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text weight="semibold" tone={reachable ? "ink" : "ink2"} numberOfLines={1} style={styles.grow}>
            {c.title}
          </Text>
          {reachable ? (
            <Text variant="meta" weight={fresh || needs ? "medium" : "regular"} tone={fresh || needs ? "accentText" : "ink3"} numbers>
              {when}
            </Text>
          ) : c.state !== "pending" ? (
            <Icon icon={LockIcon} size={12} color={colors.ink3} />
          ) : null}
        </View>
        <View style={styles.line}>
          <Text variant="ui" weight={fresh ? "medium" : "regular"} tone={fresh ? "ink" : "ink3"} numberOfLines={1} style={styles.grow}>
            {note}
          </Text>
          {needs ? (
            <View accessible accessibilityLabel={questions(needs)} style={[styles.count, { backgroundColor: colors.accent }]}>
              <Text variant="stamp" weight="semibold" tone="accentInk" numbers>
                {needs}
              </Text>
            </View>
          ) : fresh ? (
            <View accessible accessibilityLabel="New messages" style={[styles.dot, { backgroundColor: colors.accent }]} />
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

export function ChannelList({ rows, news, icons, active, now, onSelect, onNew }: ChannelListProps) {
  const { colors, radius } = useTheme()
  return (
    <FlatList
      data={rows}
      keyExtractor={(c) => c.room}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New channel"
          onPress={onNew}
          style={({ pressed }) => [styles.new, { borderRadius: radius.card, backgroundColor: pressed ? colors.wash : "transparent" }]}
        >
          <View style={[styles.plus, { borderColor: colors.edgeStrong }]}>
            <Icon icon={Add01Icon} size={18} color={colors.ink2} />
          </View>
          <Text weight="medium" tone="ink2">
            New channel
          </Text>
        </Pressable>
      }
      ListEmptyComponent={
        <Text variant="ui" tone="ink3" style={styles.empty}>
          Channels you create or join show up here.
        </Text>
      }
      renderItem={({ item, index }) => <Row c={item} n={news[index]} icon={icons?.get(item.room) ?? null} selected={item.code === active} now={now} onPress={() => onSelect(item.code)} />}
    />
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 4 },
  new: { height: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 },
  plus: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  row: { height: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 },
  dim: { opacity: 0.55 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  empty: { paddingHorizontal: 12, paddingVertical: 16 },
})

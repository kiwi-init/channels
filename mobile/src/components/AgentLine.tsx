import { taskId } from "@mc/state.ts"
import { formatAgo } from "@web/lib/format"
import { Pressable, StyleSheet, View } from "react-native"

import { doingNow, presenceWord, queueWord, restingWord, type AgentNow } from "../lib/agents"
import { useTheme } from "../theme/useTheme"
import { Monogram } from "../ui/Monogram"
import { Text } from "../ui/Text"

export interface AgentLineProps {
  a: AgentNow
  now: number
  onOpenTask: (id: number) => void
  onPress?: (a: AgentNow) => void
  brief?: boolean
}

export function AgentLine({ a, now, onOpenTask, onPress, brief }: AgentLineProps) {
  const { colors, radius } = useTheme()
  const doing = doingNow(a)
  const resting = restingWord(a)
  const queue = queueWord(a)
  const body = (
    <>
      <View style={styles.face}>
        <Monogram name={a.label} hue={a.name} agent color={a.color} size={28} online={!!a.here} working={!!doing?.busy} />
      </View>
      <View style={styles.column}>
        <View style={styles.head}>
          <Text variant="ui" weight="semibold" numberOfLines={1} style={styles.shrink}>
            {a.label}
          </Text>
          {a.model && !brief ? (
            <Text variant="stamp" tone="ink3" numberOfLines={1} style={styles.shrink}>
              {a.model}
            </Text>
          ) : null}
          {a.coordinator ? (
            <Text variant="stamp" tone="ink3">
              coordinator
            </Text>
          ) : null}
          <Text variant="stamp" tone="ink3" style={styles.right}>
            {presenceWord(a, now, brief)}
          </Text>
        </View>
        {doing ? (
          <View style={styles.doing}>
            <View style={[styles.dot, { backgroundColor: doing.busy ? colors.doing : colors.ink3 }]} />
            <Text variant="meta" weight={doing.busy ? "medium" : "regular"} tone={doing.busy ? "ink" : "ink3"}>
              {doing.text}
            </Text>
            {a.activity?.since ? (
              <Text variant="meta" tone="ink3">
                {`· ${formatAgo(a.activity.since, now)}`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {a.load.current.map((t) => (
          <Pressable key={t.id} accessibilityRole="link" accessibilityLabel={`Open ${taskId(t.id)} ${t.title}`} onPress={() => onOpenTask(t.id)}>
            <Text variant="meta" tone="ink2" numberOfLines={1}>
              <Text variant="meta" weight="medium" tone="accentText">
                Working on
              </Text>
              {` ${taskId(t.id)} ${t.title}`}
            </Text>
          </Pressable>
        ))}
        {resting ? (
          <Text variant="meta" tone="ink3">
            {resting}
          </Text>
        ) : null}
        {queue ? (
          <Text variant="stamp" tone="ink3">
            {queue}
          </Text>
        ) : null}
      </View>
    </>
  )
  if (!onPress) return <View style={styles.row}>{body}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${a.label}, ${presenceWord(a, now, true)}`}
      onPress={() => onPress(a)}
      style={({ pressed }) => [styles.row, { borderRadius: radius.ctl, backgroundColor: pressed ? colors.wash : "transparent" }]}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 8, paddingVertical: 8 },
  face: { paddingTop: 2 },
  column: { flex: 1, minWidth: 0, gap: 2 },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  shrink: { flexShrink: 1 },
  right: { marginLeft: "auto" },
  doing: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
})

import type { TaskState } from "@mc/protocol.ts"
import type { Task } from "@mc/state.ts"
import { formatAgo } from "@web/lib/format"
import { FlatList, Pressable, StyleSheet, View } from "react-native"

import { labelOf, sortTasks, taskId } from "../lib/tasks"
import { useTheme } from "../theme/useTheme"
import { Text } from "../ui/Text"

export function StateMark({ state }: { state: TaskState }) {
  const { colors } = useTheme()
  const fill = { todo: colors.ink3, doing: colors.doing, review: colors.decide, done: colors.live }[state]
  return (
    <View accessibilityLabel={labelOf({ state })} style={styles.markBox}>
      <View style={[styles.mark, { backgroundColor: fill, opacity: state === "todo" ? 0.55 : 1 }]} />
    </View>
  )
}

export interface TaskListProps {
  tasks: readonly Task[]
  nameOf: (name: string) => string
  now: number
  onOpen: (id: number) => void
}

export function TaskList({ tasks, nameOf, now, onOpen }: TaskListProps) {
  const { colors } = useTheme()
  return (
    <FlatList
      data={sortTasks(tasks)}
      keyExtractor={(task) => String(task.id)}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text tone="ink2">No tasks yet.</Text>
        </View>
      }
      renderItem={({ item: task }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open task ${taskId(task.id)}: ${task.title}`} onPress={() => onOpen(task.id)} style={styles.row}>
          <StateMark state={task.state} />
          <View style={[styles.body, { borderBottomColor: colors.line }]}>
            <View style={styles.text}>
              <Text tone={task.state === "done" ? "ink2" : "ink"}>{task.title}</Text>
              <Text variant="meta" tone="ink3" numbers numberOfLines={1}>
                {`${taskId(task.id)}${task.cancelled ? " · Cancelled" : ""}${task.notes.length ? ` · ${task.notes.length === 1 ? "1 note" : `${task.notes.length} notes`}` : ""} · ${formatAgo(task.updatedAt, now)}`}
              </Text>
            </View>
            <Text variant="ui" tone="ink3" numberOfLines={1} style={styles.owner}>
              {task.owner ? nameOf(task.owner) : "Unassigned"}
            </Text>
          </View>
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  empty: { padding: 24 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 16 },
  markBox: { width: 16, height: 16, alignItems: "center", justifyContent: "center", marginRight: 12 },
  mark: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingRight: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
  owner: { maxWidth: 110 },
})

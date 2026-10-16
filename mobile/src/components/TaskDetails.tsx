import type { Task } from "@mc/state.ts"
import { formatAgo, formatFull } from "@web/lib/format"
import { useState, type ReactNode } from "react"
import { ScrollView, StyleSheet, View } from "react-native"

import { labelOf, roundLine, taskId } from "../lib/tasks"
import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"
import { Markdown } from "./Markdown"
import { StateMark } from "./TaskList"

export interface TaskDetailsProps {
  task: Task | undefined
  nameOf: (name: string) => string
  now: number
  noteBlocked: string | null
  onNote: (text: string) => Promise<void>
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.prop}>
      <Text variant="meta" weight="medium" tone="ink3">
        {label}
      </Text>
      <View style={styles.value}>{children}</View>
    </View>
  )
}

export function TaskDetails({ task, nameOf, now, noteBlocked, onNote }: TaskDetailsProps) {
  const { colors, radius } = useTheme()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  if (!task) {
    return (
      <View style={styles.pad}>
        <Text variant="title">This task is gone</Text>
        <Text tone="ink2">It was pruned from the channel’s history.</Text>
      </View>
    )
  }

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await onNote(text.trim())
      setText("")
    } finally {
      setBusy(false)
    }
  }

  const review = task.review === "*" ? "Anyone who hasn’t worked on it" : task.review ? nameOf(task.review) : null

  return (
    <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <View style={styles.title}>
        <StateMark state={task.state} />
        <Text variant="title" style={styles.titleText}>
          {task.title}
        </Text>
      </View>
      {task.detail ? <Markdown tone="ink2">{task.detail}</Markdown> : null}

      <View style={styles.props}>
        <Prop label="Status">
          <Text variant="ui">{labelOf(task)}</Text>
        </Prop>
        <Prop label="Assignee">
          <Text variant="ui" tone={task.owner ? "ink" : "ink3"}>
            {task.owner ? nameOf(task.owner) : "Nobody yet"}
          </Text>
        </Prop>
        {review ? (
          <Prop label="Review">
            <Text variant="ui" tone="ink2">
              {`${review}${task.approvedBy ? `, approved by ${nameOf(task.approvedBy)}` : task.state === "review" ? ", waiting" : ""}`}
            </Text>
          </Prop>
        ) : null}
        <Prop label="Created">
          <Text variant="ui" tone="ink2" accessibilityLabel={formatFull(task.createdAt)}>
            {`by ${nameOf(task.createdBy)}, ${formatAgo(task.createdAt, now)}`}
          </Text>
        </Prop>
      </View>

      {task.rounds.length ? (
        <View style={styles.section}>
          <Text variant="ui" weight="semibold">
            Review rounds
          </Text>
          {task.rounds.map((round) => (
            <Text key={round.seq} variant="ui" tone="ink2">
              {roundLine(round, nameOf)}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="ui" weight="semibold">
          {`Notes ${task.notes.length}`}
        </Text>
        {task.notes.map((note) => (
          <View key={note.seq} style={[styles.note, { backgroundColor: colors.field, borderRadius: radius.card }]}>
            <Text variant="ui">{note.text}</Text>
            <Text variant="meta" tone="ink3">
              {`${nameOf(note.by)} · ${formatAgo(note.ts, now)}`}
            </Text>
          </View>
        ))}
        {noteBlocked ? (
          <Text variant="ui" tone="ink3">
            {noteBlocked}
          </Text>
        ) : (
          <>
            <TextField label={`Comment on ${taskId(task.id)}`} value={text} onChangeText={setText} multiline />
            <Button title="Comment" size="sm" disabled={!text.trim() || busy} onPress={() => void submit()} />
          </>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  title: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  titleText: { flex: 1 },
  props: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 4 },
  prop: { minWidth: "40%", gap: 4 },
  value: { flexDirection: "row", alignItems: "center", gap: 6 },
  section: { gap: 8, marginTop: 8 },
  note: { padding: 12, gap: 2 },
})

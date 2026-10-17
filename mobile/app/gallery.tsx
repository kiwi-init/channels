import { fold, type Task } from "@mc/state.ts"
import { useRouter } from "expo-router"
import { useMemo, useState, type ReactNode } from "react"
import { ScrollView, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { AgentStrip } from "../src/components/AgentStrip"
import { Bubble } from "../src/components/Bubble"
import { Markdown } from "../src/components/Markdown"
import { NeedsYou } from "../src/components/NeedsYou"
import { ReactionChip } from "../src/components/ReactionChip"
import { TaskList } from "../src/components/TaskList"
import { AGENTS_NOW, fixtureAgents } from "../src/fixtures/agents"
import { fixtureMessages, fixtureRoster, SELF } from "../src/fixtures/channel"
import { gifs } from "../src/lib/gifs"
import { useTheme } from "../src/theme/useTheme"
import { Button } from "../src/ui/Button"
import { Pill } from "../src/ui/Pill"
import { Sheet } from "../src/ui/Sheet"
import { Switch } from "../src/ui/Switch"
import { Text } from "../src/ui/Text"
import { TextField } from "../src/ui/TextField"
import { toast } from "../src/ui/Toast"

const SAMPLE =
  "# A heading\n\nSome **bold**, *italic* and `inline code`, a [link](https://example.com).\n\n- one\n- two\n\n```sh\nkiwi -c channels-dev status\n```\n\n| n | name |\n| - | - |\n| 10 | b |\n| 2 | a |\n"

const task = (id: number, state: Task["state"], title: string, over: Partial<Task> = {}): Task => ({
  id,
  title,
  state,
  createdBy: "jow",
  createdAt: AGENTS_NOW - 3_600_000,
  updatedAt: AGENTS_NOW - id * 60_000,
  notes: [],
  workedBy: [],
  rounds: [],
  ...over,
})

const TASKS = [
  task(1, "doing", "Wire the shell", { owner: "merge-bus" }),
  task(2, "review", "Settings", { owner: "kiwi-browser", review: "*" }),
  task(3, "todo", "Landing page"),
  task(4, "done", "Tokens", { owner: "merge-bus" }),
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="title">{title}</Text>
      {children}
    </View>
  )
}

export default function Gallery() {
  const router = useRouter()
  const { colors } = useTheme()
  const [sheet, setSheet] = useState(false)
  const [on, setOn] = useState(true)
  const [text, setText] = useState("")
  const state = useMemo(() => fold(fixtureMessages, fixtureRoster, AGENTS_NOW), [])
  const chat = fixtureMessages.filter((m) => m.kind !== "event" && !m.dm && m.task === undefined && !m.room).slice(0, 6)
  const bySeq = new Map(fixtureMessages.map((m) => [m.seq, m]))
  const asks = fixtureMessages.filter((m) => m.esc || m.kind === "ask")

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <Text variant="display">Gallery</Text>
        <Text variant="ui" weight="medium" tone="accentText" accessibilityRole="button" onPress={() => router.back()}>
          Close
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Section title="Buttons">
          <View style={styles.row}>
            <Button title="Primary" onPress={() => toast("Primary")} />
            <Button title="Secondary" variant="secondary" onPress={() => {}} />
            <Button title="Ghost" variant="ghost" onPress={() => {}} />
            <Button title="Danger" variant="danger" onPress={() => {}} />
            <Button title="Disabled" disabled onPress={() => {}} />
          </View>
          <View style={styles.row}>
            <Pill label="Neutral" />
            <Pill label="Accent" tone="accent" />
            <Pill label="Decide" tone="decide" />
          </View>
        </Section>
        <Section title="Inputs, sheet and toast">
          <TextField label="A text field" value={text} onChangeText={setText} />
          <Switch label="A switch" value={on} onValueChange={setOn} />
          <View style={styles.row}>
            <Button title="Open a sheet" variant="secondary" onPress={() => setSheet(true)} />
            <Button title="Show a toast" variant="secondary" onPress={() => toast("Copied")} />
          </View>
          <Sheet visible={sheet} onClose={() => setSheet(false)} title="A sheet">
            <Text>Tap outside to close.</Text>
          </Sheet>
        </Section>
        <Section title="Messages">
          {chat.map((m, index) => (
            <Bubble
              key={m.seq}
              m={m}
              me={SELF}
              trust={state.trust.get(m.seq)}
              first
              last={index === chat.length - 1 || chat[index + 1]!.from !== m.from}
              group
              adjacentReply={false}
              quoted={(seq) => bySeq.get(seq)}
              nameOf={(n) => n}
              onJump={() => {}}
            />
          ))}
        </Section>
        <Section title="Markdown">
          <Markdown>{SAMPLE}</Markdown>
        </Section>
        <Section title="Reactions">
          <View style={styles.row}>
            <ReactionChip chip={{ emoji: "👍", who: ["ann", "bo"], mine: true }} />
            <ReactionChip chip={{ emoji: "🎉", who: ["ann"], mine: false }} />
            {gifs[0] ? <ReactionChip chip={{ emoji: gifs[0].key, who: ["jow"], mine: false }} /> : null}
          </View>
        </Section>
        <Section title="Agents">
          <AgentStrip agents={fixtureAgents} now={AGENTS_NOW} onOpenTask={() => {}} />
        </Section>
        <Section title="Tasks">
          <View style={styles.list}>
            <TaskList tasks={TASKS} nameOf={(n) => n} now={AGENTS_NOW} onOpen={() => {}} />
          </View>
        </Section>
        <Section title="Needs you">
          <NeedsYou
            now={AGENTS_NOW}
            me={SELF}
            requests={[{ id: "r1", name: "Ann", role: "designer", code: "344-230", check: "ready" }]}
            escalations={asks.filter((m) => m.esc)}
            questions={asks.filter((m) => !m.esc)}
            reviews={[TASKS[1]!]}
            nameOf={(n) => n}
            onCheckRequest={async () => {}}
            onApproveRequest={async () => toast("Approved")}
            onDenyRequest={async () => {}}
            onReply={async () => toast("Sent")}
            onApproveTask={async () => {}}
            onSendBack={async () => {}}
            onOpenTask={() => {}}
            onJump={() => {}}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  body: { padding: 16, gap: 24 },
  section: { gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  list: { height: 260 },
})

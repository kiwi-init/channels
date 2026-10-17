import type { JoinRequest } from "@mc/membership.ts"
import { HANDOFF_DONE, HANDOFF_FAILED, type Message } from "@mc/protocol.ts"
import { taskId, type Task } from "@mc/state.ts"
import { askLabel } from "@web/lib/asks"
import { excerpt, formatAgo } from "@web/lib/format"
import { handoffLabel, handoffLeft, handoffOf, handoffOpen } from "@web/lib/handoff"
import { useState, type ReactNode } from "react"
import { Linking, StyleSheet, View } from "react-native"

import { safeUrl } from "../lib/markdown"
import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"

type Request = Pick<JoinRequest, "id" | "name" | "role" | "code" | "check">

export interface NeedsYouProps {
  now: number
  me: string
  requests: readonly Request[]
  escalations: readonly Message[]
  questions: readonly Message[]
  reviews: readonly Task[]
  nameOf: (name: string) => string
  onCheckRequest: (id: string) => Promise<void>
  onApproveRequest: (id: string) => Promise<void>
  onDenyRequest: (id: string) => Promise<void>
  onReply: (m: Message, text: string) => Promise<void>
  onApproveTask: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onOpenTask: (id: number) => void
  onJump: (seq: number) => void
}

function Card({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const { colors, radius } = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.line, borderRadius: radius.card }]}>
      <Text variant="ui" weight="semibold">
        {title}
      </Text>
      {meta ? (
        <Text variant="meta" tone="ink3">
          {meta}
        </Text>
      ) : null}
      {children}
    </View>
  )
}

function useBusy(): [boolean, (run: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false)
  return [
    busy,
    async (run) => {
      setBusy(true)
      try {
        await run()
      } finally {
        setBusy(false)
      }
    },
  ]
}

function RequestCard({ request, onCheck, onApprove, onDeny }: { request: Request; onCheck: () => Promise<void>; onApprove: () => Promise<void>; onDeny: () => Promise<void> }) {
  const [busy, run] = useBusy()
  const waiting = request.check !== "ready"
  return (
    <Card title={`${request.name} wants to join`} meta={request.role}>
      {request.check === "ready" && request.code ? (
        <Text tone="ink2">{`Ask them for the digits on their phone. They should read ${request.code}.`}</Text>
      ) : (
        <Text tone="ink2">{request.check === "unchecked" ? "Start the check to get the digits." : "Waiting for their half of the check."}</Text>
      )}
      <View style={styles.actions}>
        {request.check === "unchecked" ? <Button title="Start check" size="sm" disabled={busy} onPress={() => void run(onCheck)} /> : null}
        <Button title="Approve" size="sm" disabled={waiting || busy} onPress={() => void run(onApprove)} />
        <Button title="Deny" size="sm" variant="secondary" disabled={busy} onPress={() => void run(onDeny)} />
      </View>
    </Card>
  )
}

function AskCard({
  m,
  me,
  now,
  nameOf,
  onReply,
  onJump,
}: {
  m: Message
  me: string
  now: number
  nameOf: (n: string) => string
  onReply: (m: Message, text: string) => Promise<void>
  onJump: (seq: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const handoff = handoffOf(m)
  const live = !!handoff && handoffOpen(handoff, now)
  const link = handoff ? safeUrl(handoff.url) : undefined
  const choices = !handoff && m.choices?.length ? m.choices : []
  const answer = (text: string) => run(() => onReply(m, text))
  return (
    <Card
      title={`${handoff ? "Browser for you" : askLabel(m, me)} from ${nameOf(m.from)}`}
      meta={`${formatAgo(m.ts, now)}${handoff ? ` · ${handoffLabel(handoff)} · ${live ? handoffLeft(handoff, now) : "link expired"}` : ""}`}
    >
      <Text tone="ink2" accessibilityRole="button" onPress={() => onJump(m.seq)}>
        {excerpt(m.body, 220)}
      </Text>
      {choices.length ? (
        <View accessibilityLabel="Options" style={styles.options}>
          {choices.map((choice) => (
            <Button key={choice} title={choice} variant="secondary" size="sm" disabled={busy} accessibilityLabel={`Answer: ${choice}`} onPress={() => void answer(choice)} />
          ))}
        </View>
      ) : null}
      {handoff && live && link ? (
        <View style={styles.actions}>
          <Button title="Open browser" size="sm" onPress={() => void Linking.openURL(link)} />
          <Button title="Done" size="sm" variant="secondary" disabled={busy} onPress={() => void answer(HANDOFF_DONE)} />
          <Button title="Couldn’t" size="sm" variant="ghost" disabled={busy} onPress={() => void answer(HANDOFF_FAILED)} />
        </View>
      ) : handoff ? (
        <Text variant="meta" tone="ink3">
          Link expired
        </Text>
      ) : null}
      {draft === null ? (
        <View style={styles.actions}>
          <Button title={choices.length ? "Something else" : "Answer"} size="sm" variant={choices.length ? "ghost" : "secondary"} onPress={() => setDraft("")} />
          <Button title="Show" size="sm" variant="ghost" onPress={() => onJump(m.seq)} />
        </View>
      ) : (
        <>
          <TextField label={`Reply to ${nameOf(m.from)}`} value={draft} onChangeText={setDraft} multiline autoFocus />
          <View style={styles.actions}>
            <Button
              title="Send reply"
              size="sm"
              disabled={!draft.trim() || busy}
              onPress={() =>
                void run(async () => {
                  await onReply(m, draft.trim())
                  setDraft(null)
                })
              }
            />
            <Button title="Cancel" size="sm" variant="ghost" onPress={() => setDraft(null)} />
          </View>
        </>
      )}
    </Card>
  )
}

function ReviewCard({ task, onApprove, onSendBack, onOpen }: { task: Task; onApprove: () => Promise<void>; onSendBack: (why: string) => Promise<void>; onOpen: () => void }) {
  const [why, setWhy] = useState("")
  const [back, setBack] = useState(false)
  const [busy, run] = useBusy()
  return (
    <Card title={`${taskId(task.id)} is waiting for your review`} meta={task.title}>
      <View style={styles.actions}>
        <Button title="Approve" size="sm" disabled={busy} onPress={() => void run(onApprove)} />
        <Button title="Send back" size="sm" variant="secondary" disabled={busy} onPress={() => setBack((open) => !open)} />
        <Button title="Open task" size="sm" variant="ghost" onPress={onOpen} />
      </View>
      {back ? (
        <>
          <TextField label="Why" value={why} onChangeText={setWhy} multiline />
          <Button
            title="Send it back"
            size="sm"
            disabled={!why.trim() || busy}
            onPress={() =>
              void run(async () => {
                await onSendBack(why.trim())
                setWhy("")
                setBack(false)
              })
            }
          />
        </>
      ) : null}
    </Card>
  )
}

export function NeedsYou({
  now,
  me,
  requests,
  escalations,
  questions,
  reviews,
  nameOf,
  onCheckRequest,
  onApproveRequest,
  onDenyRequest,
  onReply,
  onApproveTask,
  onSendBack,
  onOpenTask,
  onJump,
}: NeedsYouProps) {
  const total = requests.length + escalations.length + questions.length + reviews.length
  if (total === 0) {
    return (
      <View style={styles.pad}>
        <Text tone="ink2">Nothing needs you right now.</Text>
      </View>
    )
  }
  return (
    <View style={styles.pad}>
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} onCheck={() => onCheckRequest(request.id)} onApprove={() => onApproveRequest(request.id)} onDeny={() => onDenyRequest(request.id)} />
      ))}
      {escalations.map((m) => (
        <AskCard key={`e${m.seq}`} m={m} me={me} now={now} nameOf={nameOf} onReply={onReply} onJump={onJump} />
      ))}
      {questions.map((m) => (
        <AskCard key={`q${m.seq}`} m={m} me={me} now={now} nameOf={nameOf} onReply={onReply} onJump={onJump} />
      ))}
      {reviews.map((task) => (
        <ReviewCard key={task.id} task={task} onApprove={() => onApproveTask(task)} onSendBack={(why) => onSendBack(task, why)} onOpen={() => onOpenTask(task.id)} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  card: { padding: 14, gap: 8, borderWidth: StyleSheet.hairlineWidth },
  options: { gap: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
})

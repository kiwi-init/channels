import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { JoinRequest } from "@mc/membership.ts"
import type { ImageAttachment, Message } from "@mc/protocol.ts"
import { openRound, taskId, type Task } from "@mc/state.ts"
import { asksFor } from "@web/lib/asks"
import { excerpt } from "@web/lib/format"

import { AgentStrip } from "../components/AgentStrip"
import { Conversation } from "../components/Conversation"
import { NeedsYou } from "../components/NeedsYou"
import { ReactionPicker } from "../components/ReactionPicker"
import { TaskDetails } from "../components/TaskDetails"
import { TaskList } from "../components/TaskList"
import { Thread } from "../components/Thread"
import { threadIndex } from "../lib/thread"
import { useServices } from "../lib/EngineProvider"
import { shareImage } from "../lib/shareImage"
import { lightTap } from "../lib/haptics"
import { useChannel } from "../lib/useChannel"
import { useTheme } from "../theme/useTheme"
import { Composer, type Person } from "../ui/Composer"
import { ImageViewer } from "../ui/ImageViewer"
import { Text } from "../ui/Text"
import { toast } from "../ui/Toast"

type Tab = "chat" | "tasks" | "needs"

const NO_BUDGET = { load: () => [], save: () => {} }

export function ChannelScreen({ code, onBack }: { code: string; onBack?: () => void }) {
  const { colors } = useTheme()
  const { engine, history, sql } = useServices()
  const seat = engine.joined().find((entry) => entry.code === code)
  const channel = useMemo(() => engine.channel(code), [engine, code])
  const live = useChannel(channel, seat?.pk ?? "", history, sql)
  const me = channel?.identity.name ?? ""
  const [threadRoot, setThreadRoot] = useState<number | null>(null)
  const threads = useMemo(() => threadIndex(live.messages, live.state), [live.messages, live.state])
  const [viewing, setViewing] = useState<ImageAttachment | null>(null)
  const [view, setView] = useState<Tab>("chat")
  const [openTask, setOpenTask] = useState<number | null>(null)
  const [reactTo, setReactTo] = useState<Message | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [now, setNow] = useState(() => Date.now())
  const myMember = live.state.members.get(me)
  const isOwner = !!myMember?.owner
  const iAmPerson = myMember?.kind === "human"

  const people: Person[] = useMemo(
    () =>
      [...live.state.members.values()]
        .filter((member) => member.active && member.name !== me)
        .map((member) => ({ name: member.name, label: member.display || member.name, agent: member.kind !== "human" })),
    [live.state, me]
  )
  const nameOf = useMemo(() => (name: string) => live.state.members.get(name)?.display || name, [live.state])

  const asks = useMemo(() => asksFor(live.state.openAsks, me), [live.state.openAsks, me])
  const reviews: Task[] = useMemo(
    () => (iAmPerson ? [...live.state.tasks.values()].filter((t) => t.state === "review" && !!t.review && (t.review === me || (t.review === "*" && t.owner !== me && !t.workedBy.includes(me)))) : []),
    [live.state.tasks, me, iAmPerson]
  )
  const needsCount = asks.escalations.length + asks.questions.length + reviews.length + (isOwner ? requests.length : 0)

  const refreshRequests = useCallback(async () => {
    if (!channel || !isOwner) return
    setRequests(await channel.requests({ budget: NO_BUDGET }).catch(() => []))
  }, [channel, isOwner])

  useEffect(() => {
    const first = setTimeout(() => void refreshRequests(), 0)
    const tick = setInterval(() => {
      setNow(Date.now())
      void refreshRequests()
    }, 5000)
    return () => {
      clearTimeout(first)
      clearInterval(tick)
    }
  }, [refreshRequests])

  const person = engine.person()?.pk
  const roundOf = (task: Task) => {
    const open = openRound(task)
    return open ? { round: open.n, ...(open.at ? { at: open.at } : {}) } : {}
  }
  const requestById = (id: string) => requests.find((r) => r.id === id)

  const root = threadRoot === null ? undefined : live.messages.find((m) => m.seq === threadRoot)
  const replies = threadRoot === null ? [] : (threads.replies.get(threadRoot) ?? [])

  const send = async ({ body, to }: { body: string; to: string[] }, re?: number[]) => {
    lightTap()
    try {
      await live.send(body, to, re)
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send", "error")
      throw err
    }
  }

  if (channel && root) {
    const last = replies.length ? replies[replies.length - 1]!.seq : root.seq
    return (
      <Thread
        root={root}
        replies={replies}
        state={live.state}
        me={me}
        nameOf={nameOf}
        onClose={() => setThreadRoot(null)}
        composer={<Composer me={me} people={people} placeholder="Reply in thread" onSend={(draft) => send(draft, [last])} />}
      />
    )
  }

  if (!channel) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <Text tone="ink2" style={styles.missing}>
          This channel is not on this phone.
        </Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Text variant="ui" weight="medium" tone="accentText" onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to channels">
          Channels
        </Text>
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {seat?.name || seat?.label || "Channel"}
        </Text>
        <Text variant="stamp" tone={live.connected ? "live" : "ink3"}>
          {live.connected ? "Live" : "Connecting"}
        </Text>
      </View>
      <View style={[styles.tabs, { borderBottomColor: colors.line }]}>
        {(["chat", "tasks", "needs"] as const).map((tab) => {
          const label = tab === "chat" ? "Chat" : tab === "tasks" ? `Tasks ${live.state.tasks.size}` : `Needs you${needsCount ? ` ${needsCount}` : ""}`
          return (
            <Text
              key={tab}
              variant="ui"
              weight={view === tab ? "semibold" : "regular"}
              tone={view === tab ? "accentText" : "ink3"}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: view === tab }}
              onPress={() => (setView(tab), setOpenTask(null))}
            >
              {label}
            </Text>
          )
        })}
      </View>
      {view === "chat" ? (
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Conversation
            messages={live.messages}
            state={live.state}
            me={me}
            nameOf={nameOf}
            group={people.length > 1}
            onOpenThread={setThreadRoot}
            onOpenImage={setViewing}
            onReact={setReactTo}
            onReply={setReplyTo}
            onOpenTask={(id) => (setView("tasks"), setOpenTask(id))}
          />
          <AgentStrip agents={live.agents} now={now} onOpenTask={(id) => (setView("tasks"), setOpenTask(id))} />
          <Composer
            me={me}
            people={people}
            replyTo={replyTo ? { label: nameOf(replyTo.from), text: excerpt(replyTo.body, 80) } : null}
            onClearReply={() => setReplyTo(null)}
            onSend={async (draft) => {
              await send(draft, replyTo ? [replyTo.seq] : undefined)
              setReplyTo(null)
            }}
          />
        </KeyboardAvoidingView>
      ) : view === "tasks" ? (
        openTask === null ? (
          <TaskList tasks={[...live.state.tasks.values()]} nameOf={nameOf} now={now} onOpen={setOpenTask} />
        ) : (
          <TaskDetails
            task={live.state.tasks.get(openTask)}
            nameOf={nameOf}
            now={now}
            noteBlocked={null}
            onNote={async (note) => void (await live.post(`noted on ${taskId(openTask)}`, { kind: "event", ev: { op: "task.update", task: openTask, note } }))}
          />
        )
      ) : (
        <NeedsYou
          now={now}
          me={me}
          requests={isOwner ? requests : []}
          escalations={asks.escalations}
          questions={asks.questions}
          reviews={reviews}
          nameOf={nameOf}
          onCheckRequest={async (id) => {
            const req = requestById(id)
            if (req) await channel?.checkRequest(req)
            await refreshRequests()
          }}
          onApproveRequest={async (id) => {
            const req = requestById(id)
            if (req) await channel?.approve(req, undefined, person ? { person } : {})
            await refreshRequests()
          }}
          onDenyRequest={async (id) => {
            await channel?.deny(id)
            await refreshRequests()
          }}
          onReply={async (m, text) => void (await live.post(text, { to: [m.from], re: [m.seq], kind: "msg" }))}
          onApproveTask={async (t) =>
            void (await live.post(`${taskId(t.id)} approved`, {
              kind: "event",
              ev: { op: "task.update", task: t.id, state: "done", verdict: "approved", note: "approved", ...roundOf(t) },
              ...(t.owner ? { to: [t.owner] } : {}),
            }))
          }
          onSendBack={async (t, why) =>
            void (await live.post(`${taskId(t.id)} rejected`, {
              kind: "event",
              ev: { op: "task.update", task: t.id, state: "doing", verdict: "rejected", note: why, ...roundOf(t) },
              ...(t.owner ? { to: [t.owner] } : {}),
            }))
          }
          onOpenTask={(id) => (setView("tasks"), setOpenTask(id))}
          onJump={() => setView("chat")}
        />
      )}
      <ReactionPicker
        visible={reactTo !== null}
        onClose={() => setReactTo(null)}
        onPick={(emoji) => {
          if (reactTo) void live.post("reaction", { kind: "event", ev: { op: "react", seq: reactTo.seq, emoji } }).catch(() => toast("Could not react", "error"))
        }}
      />
      <ImageViewer
        visible={viewing !== null}
        onClose={() => setViewing(null)}
        uri={viewing ? `data:${viewing.mime};base64,${viewing.data}` : ""}
        title={viewing?.name}
        onShare={viewing ? () => void shareImage(viewing).catch(() => toast("Could not share the image", "error")) : undefined}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  missing: { padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1 },
  tabs: { flexDirection: "row", gap: 20, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
})

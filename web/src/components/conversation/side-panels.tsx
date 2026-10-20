import type { Dispatch, ReactNode, SetStateAction } from "react"

import type { GithubDiff } from "@kiwi/core/client.ts"
import type { ChannelIcon, ImageAttachment, Message } from "@kiwi/core/protocol.ts"
import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import type { ChannelHandle } from "@/lib/channel"
import { formatShort } from "@/lib/format"
import { approveTask, assignTask, cancelTask, changeReviewer, closedDigest, sendBackTask, type TaskSend } from "@/lib/task-actions"
import { sendFrom } from "@/lib/threads"
import { Composer, type Person } from "../composer"
import { Annotator, InfoPanel, TaskDetails, TasksPanel, ThreadPanel } from "../lazy"
import { isAgent } from "../message"
import { Notes } from "../tasks"
import type { Side } from "./types"

type Send = ChannelHandle["send"]

export function ThreadSide({
  root,
  count,
  rows,
  onClose,
  me,
  people,
  nameOf,
  connecting,
  send,
}: {
  root: Message
  count: number
  rows: ReactNode[]
  onClose: () => void
  me: string
  people: Person[]
  nameOf: (name: string) => string
  connecting: boolean
  send: Send
}) {
  return (
    <ThreadPanel
      count={count}
      onClose={onClose}
      composer={<Composer key={root.seq} thread me={me} people={people} replyTo={root} nameOf={nameOf} onClearReply={() => undefined} disabled={connecting} send={send} />}
    >
      {rows}
    </ThreadPanel>
  )
}

export function PictureSide({
  picture,
  nameOf,
  state,
  mayWrite,
  me,
  extra,
  send,
  onClose,
}: {
  picture: { m: Message; img: ImageAttachment; src: string }
  nameOf: (name: string) => string
  state: ChannelState
  mayWrite: boolean
  me: string
  extra: ReturnType<typeof sendFrom> | undefined
  send: Send
  onClose: () => void
}) {
  return (
    <Annotator
      picture={{ src: picture.src, name: picture.img.name, mime: picture.img.mime }}
      sender={nameOf(picture.m.from)}
      agent={isAgent(state.members.get(picture.m.from))}
      when={formatShort(picture.m.ts)}
      replyTo={mayWrite ? nameOf(picture.m.from) : undefined}
      onSend={
        mayWrite
          ? async (note, image) => {
              const pm = picture.m
              const to = pm.from !== me ? [pm.from] : extra?.to
              await send(note || image.name, {
                to,
                kind: "msg",
                re: [pm.seq],
                ...(extra?.task !== undefined ? { task: extra.task } : {}),
                ...(extra?.dm ? { to: extra.to, dm: true } : {}),
                imgs: [image],
              })
            }
          : undefined
      }
      onClose={onClose}
    />
  )
}

export function InfoSide({
  title,
  icon,
  subtitle,
  onClose,
  onPause,
  onMessage,
  onJoins,
  onNewAgent,
  state,
  now,
  send,
}: {
  title: string
  icon: ChannelIcon | null
  subtitle: string
  onClose: () => void
  onPause: (() => void) | undefined
  onMessage: (name: string) => void
  onJoins: () => void
  onNewAgent: (() => void) | undefined
  state: ChannelState
  now: number
  send: Send
}) {
  return (
    <InfoPanel
      title={title}
      icon={icon}
      subtitle={subtitle}
      onClose={onClose}
      onPause={onPause}
      onMessage={onMessage}
      onJoins={onJoins}
      onNewAgent={onNewAgent}
      hasNotes={state.facts.size > 0}
      notes={<Notes state={state} now={now} onClear={async (key) => void (await send(`cleared ${key}`, { kind: "event", ev: { op: "fact.del", key } }))} />}
    />
  )
}

export function TasksSide({
  side,
  setSide,
  task,
  taskKey,
  inTask,
  rows,
  me,
  people,
  nameOf,
  connecting,
  send,
  sendTask,
  githubDiff,
  state,
  messages,
  now,
  highlight,
  iAmPerson,
}: {
  side: Extract<Side, { kind: "tasks" }>
  setSide: Dispatch<SetStateAction<Side>>
  task: Task | undefined
  taskKey: string | null
  inTask: Message[]
  rows: ReactNode[]
  me: string
  people: Person[]
  nameOf: (name: string) => string
  connecting: boolean
  send: Send
  sendTask: (...s: TaskSend[]) => Promise<void>
  githubDiff: (repo: string, sha: string) => Promise<GithubDiff>
  state: ChannelState
  messages: Message[]
  now: number
  highlight: number | null
  iAmPerson: boolean
}) {
  const shownTask = side.task
  const saidInTask = inTask.filter((m) => m.kind !== "event").length
  return (
    <TasksPanel
      title={
        <>
          <span className="tabular-nums">{taskId(shownTask)}</span> <span className="font-normal text-ink-3">{saidInTask === 1 ? "1 message" : `${saidInTask} messages`}</span>
        </>
      }
      onClose={() => setSide(null)}
      follow={`${shownTask}:${inTask.length}`}
      composer={
        task && (
          <Composer
            key={taskKey}
            me={me}
            people={people}
            replyTo={null}
            nameOf={nameOf}
            onClearReply={() => undefined}
            disabled={connecting}
            extra={sendFrom(state, { kind: "task", task: task.id }, me)}
            placeholder={`Message in ${taskId(task.id)}`}
            send={send}
          />
        )
      }
    >
      <div className="px-3 pt-1 pb-4">
        <TaskDetails
          id={shownTask}
          state={state}
          messages={messages}
          me={me}
          now={now}
          highlighted={highlight === shownTask}
          person={iAmPerson}
          noteBlocked={state.members.get(me)?.scopes.includes("tasks") === false ? "The owner hasn’t let you change tasks here, so you can’t comment on one." : null}
          onNote={async (note) => void (await send(`noted on ${taskId(shownTask)}`, { kind: "event", ev: { op: "task.update", task: shownTask, note } }))}
          onApprove={(t) => sendTask(approveTask(t), closedDigest(state, messages, t, { by: me }))}
          onSendBack={(t, why) => sendTask(sendBackTask(t, why))}
          onCancel={(t, note) => sendTask(cancelTask(t, note, me), closedDigest(state, messages, t, { by: me, cancelled: note }))}
          onReviewer={(t, review) => sendTask(changeReviewer(t, review, me))}
          onAssign={(t, to, why) => sendTask(assignTask(t, to, why))}
          onDiff={githubDiff}
        />
        {task && !saidInTask && <p className="mt-4 text-center text-meta text-ink-3">What the agents on it say to each other shows up here.</p>}
        {rows}
      </div>
    </TasksPanel>
  )
}

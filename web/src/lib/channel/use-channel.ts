import * as Effect from "effect/Effect"
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import type { CachedRow } from "@kiwi/core/cache-row.ts"
import { ChannelGone } from "@kiwi/core/client/errors.ts"
import type { HumanSession, RoomsSetting, SendOptions } from "@kiwi/core/client.ts"
import type { JoinRequest, Member } from "@kiwi/core/membership.ts"
import type { Activity, Message, Reach } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type GuardFloor, type Roster } from "@kiwi/core/state.ts"
import { isWakeVia } from "@kiwi/core/wake.ts"
import { errorOf, linkOf, watches, type ChannelLink, type FollowEvent } from "../channel-ops"
import { readCached, rememberRow } from "../history"
import { checkedUpTo, checksToPost, issuesToPost, linksToPost, setCheckedUpTo, tasksToClose } from "../review-checks"
import { closeFromGithub } from "../task-actions"
import { wholeLog } from "../history-plan"
import { ICON_LIVE } from "../icon-event"
import { howHere } from "../presence"
import { addMarks, type Marks } from "../receipts"
import { fork } from "../runtime"
import { noteSignInGone } from "../session"
import { nextSnapshotTry } from "../snapshot-plan"
import { untilOpen } from "../until-open"
import { useClock } from "./clock"
import { noteAgentWorked } from "./recent"
import { forgetChannel, loadMember, renameChannel, type StoredMember } from "./store"
import { dropWarm, heldWindow, keepWarm, warmOf } from "./warm"

const HISTORY = 2_000

const PRESENCE_TTL = 150_000

type Connection = "connecting" | "live" | "reconnecting"

interface Online {
  client: string
  at: number
  pk?: string
  activity?: Activity
  reach?: Reach
  wakes: boolean
}

export interface ChannelHandle {
  ch: ChannelLink
  connection: Connection
  gone: "removed" | "closed" | null
  messages: Message[]
  roster: Member[]
  state: ChannelState
  online: Map<string, Online>
  isOwner: boolean
  requests: JoinRequest[]
  send: (body: string, opts: SendOptions) => Promise<number>
  refreshRequests: () => Promise<void>
  refreshRoster: () => Promise<void>
  head: number
  marks: Marks
  pkOf: (name: string) => string | undefined
}

const merged = (prev: Message[], more: Message[]) => {
  const seen = new Set(prev.map((p) => p.seq))
  return [...prev, ...more.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq)
}

export function useChannel(member: StoredMember, human?: HumanSession | null): ChannelHandle {
  const ch = useMemo(() => linkOf(member), [member])
  const [was] = useState(() => warmOf(member.code))
  const [connection, setConnection] = useState<Connection>("connecting")
  const [start, setStart] = useState<{ head: number; whole: boolean } | null>(null)
  const [gone, setGone] = useState<"removed" | "closed" | null>(null)
  const [messages, setMessages] = useState<Message[]>(was?.messages ?? [])
  const [roster, setRoster] = useState<Member[]>(was?.roster ?? [])
  const [online, setOnline] = useState<Map<string, Online>>(new Map())
  const [marks, setMarks] = useState<Marks>(was?.marks ?? new Map())
  const [requests, setRequests] = useState<JoinRequest[]>(was?.requests ?? [])
  const now = useClock(15_000)
  const isOwner = ch.isOwner

  const [infoAt, setInfoAt] = useState(0)
  const [guardFloor, setGuardFloor] = useState<GuardFloor | null>(was?.guardFloor ?? null)
  const [roomsFloor, setRoomsFloor] = useState<RoomsSetting | null>(was?.roomsFloor ?? null)
  useEffect(() => {
    if (gone) dropWarm(member.code)
    else keepWarm(member.code, { messages, roster, requests, marks, guardFloor, roomsFloor })
  }, [member.code, gone, messages, roster, requests, marks, guardFloor, roomsFloor])
  useEffect(() => {
    const title = ch.title()
    const guard = ch.guard()
    const rooms = ch.rooms()
    void title
      .then((name) => {
        const stored = loadMember(member.code)
        if (name && stored && stored.name !== name) void renameChannel(member.code, name)
      })
      .catch(() => {})
    void guard.then(setGuardFloor, () => {})
    void rooms.then(setRoomsFloor, () => {})
  }, [ch, member.code, infoAt])

  const onGone = useCallback(
    (err: unknown) => {
      noteSignInGone(err)
      if (!(err instanceof ChannelGone)) return false
      void forgetChannel(member.code)
      setGone(err.why)
      return true
    },
    [member.code]
  )

  const refreshRoster = useCallback(async () => {
    try {
      setRoster(await ch.members())
      if (ch.isOwner && (await ch.rotateIfDue())) setRoster(await ch.members())
    } catch (err) {
      onGone(err)
    }
  }, [ch, onGone])
  const refreshRequests = useCallback(async () => {
    if (!ch.isOwner) return
    try {
      setRequests(await ch.requests())
    } catch (err) {
      onGone(err)
    }
  }, [ch, onGone])

  useEffect(() => {
    if (human === null) return
    const lent = watches().lend(member.code)
    let pending: { message: Message; row: CachedRow | null }[] = []
    let flush: number | undefined
    let stopLive: (() => void) | null = null
    let closed = false
    const enqueue = (message: Message, row: CachedRow | null) => {
      pending.push({ message, row })
      flush ??= window.setTimeout(() => {
        const batch = pending
        pending = []
        flush = undefined
        setMessages((prev) =>
          merged(
            prev,
            batch.map((b) => b.message)
          )
        )
        lent.emit({ _tag: "Head", seq: Math.max(...batch.map((b) => b.message.seq)) })
        if (batch.some((b) => b.message.kind === "event" && b.message.ev?.op === "card")) noteAgentWorked()
        for (const b of batch) if (b.row) void rememberRow(ch.roomId, ch.pk, b.row, HISTORY).catch(() => {})
      }, 30)
    }
    const onEvent = (ev: FollowEvent) => {
      switch (ev._tag) {
        case "Open":
          setConnection("live")
          lent.emit({ _tag: "Open" })
          if (ev.kind !== "page") {
            void refreshRequests()
            void refreshRoster()
          }
          void ch.presence({ client: "probe", query: true }).catch(() => {})
          return
        case "Message":
          return enqueue(ev.message, ev.row)
        case "Presence": {
          const p = ev.presence
          if (p.client === "probe" || !p.sigOk) return
          setOnline((prev) =>
            new Map(prev).set(p.from, {
              client: p.client,
              at: Date.now(),
              pk: p.pk,
              ...(p.activity ? { activity: p.activity } : {}),
              ...(p.reach ? { reach: p.reach } : {}),
              wakes: isWakeVia(p.wake) && p.wake !== "hooks",
            })
          )
          return
        }
        case "Roster":
          void refreshRequests()
          return void refreshRoster()
        case "Request":
          lent.emit({ _tag: "Request" })
          return void refreshRequests()
        case "Read":
          setMarks((prev) => addMarks(prev, ev.reads, ev.snapshot))
          return
        case "Info":
          setInfoAt(Date.now())
          window.dispatchEvent(new CustomEvent(ICON_LIVE, { detail: member.code }))
          return
        case "Status":
          return
        case "Down":
          setConnection("reconnecting")
          return
        case "Failed":
          if (!onGone(errorOf(ev.error))) setConnection("reconnecting")
          return
      }
    }
    const opening = untilOpen(
      Effect.tryPromise({
        try: async () => {
          await Promise.all([refreshRoster(), refreshRequests()])
          const head = await ch.head()
          const held = heldWindow(was, head, HISTORY)
          if (held) return { head, cached: null, since: held.since, firstSeq: held.firstSeq }
          const cached = await readCached(ch.roomId, ch.pk, ch.openRows, head, HISTORY).catch(() => null)
          const since = cached ? cached.since : Math.max(0, head - HISTORY)
          return { head, cached, since, firstSeq: cached?.messages[0]?.seq }
        },
        catch: (err) => err,
      }),
      () => Effect.sync(() => setConnection("reconnecting"))
    )
    const stop = fork(
      opening.pipe(
        Effect.flatMap((opened) =>
          Effect.sync(() => {
            if (closed) return
            if (opened.cached?.messages.length) {
              const cached = opened.cached.messages
              setMessages((prev) => merged(prev, cached))
              if (cached.some((m) => m.kind === "event" && m.ev?.op === "card")) noteAgentWorked()
            }
            setStart({ head: opened.head, whole: wholeLog(opened.head, HISTORY, opened.firstSeq) })
            stopLive = ch.follow(opened.since, onEvent)
          })
        ),
        Effect.catch((err) => Effect.sync(() => void onGone(err)))
      )
    )
    return () => {
      closed = true
      stop()
      stopLive?.()
      clearTimeout(flush)
      lent.release()
    }
  }, [ch, refreshRoster, refreshRequests, onGone, human, member.code, was])

  const keyOf = useMemo(() => new Map(roster.filter((r) => r.active).map((r) => [r.name, r.pk])), [roster])
  const rosterForFold: Roster = useMemo(
    () =>
      roster.map((m) => ({
        name: m.name,
        pk: m.pk,
        role: m.role,
        about: m.about,
        owner: m.owner,
        at: m.at,
        active: m.active,
        kind: m.kind,
        display: m.display,
        sponsor: m.sponsor,
        ...(m.scopes ? { scopes: m.scopes } : {}),
        ...(m.later ? { later: m.later } : {}),
        ...(m.laterRole ? { laterRole: m.laterRole } : {}),
        ...(m.runs ? { runs: m.runs } : {}),
        ...(m.persona ? { persona: m.persona } : {}),
      })),
    [roster]
  )
  const state = useMemo(() => fold(messages, rosterForFold, now, roomsFloor, guardFloor), [messages, rosterForFold, now, roomsFloor, guardFloor])

  const scopesKey = useMemo(() => [...state.members.values()].map((m) => `${m.pk}:${m.scopes.join(",")}`).join("|"), [state])
  const bitsKey = useMemo(() => roster.map((m) => `${m.pk}:${m.readOnly ? 0 : 1}`).join("|"), [roster])
  const caughtUp = !!start?.whole && (messages.at(-1)?.seq ?? 0) >= start.head
  const reconcile = useEffectEvent(() => {
    if (!ch.isOwner || !caughtUp || roster.length === 0) return
    ch.reconcilePosting(state, roster).then(
      (changed) => {
        if (changed.length) void refreshRoster()
      },
      () => {}
    )
  })
  useEffect(() => reconcile(), [scopesKey, bitsKey, caughtUp])
  const snapshotNext = useRef(nextSnapshotTry(0, 0))
  const snapshotBusy = useRef(false)
  const snapshotIfDue = useEffectEvent(() => {
    const head = state.head
    if (!ch.isOwner || snapshotBusy.current || head < snapshotNext.current) return
    snapshotBusy.current = true
    ch.snapshotIfDue()
      .then(async (n) => {
        snapshotNext.current = nextSnapshotTry(head, n ?? (await ch.snapshotAt()) ?? 0)
      })
      .catch(() => {})
      .finally(() => {
        snapshotBusy.current = false
      })
  })
  useEffect(() => snapshotIfDue(), [state.head])
  const checksBusy = useRef(false)
  const postReviewChecks = useEffectEvent(() => {
    if (!ch.isOwner || !caughtUp || !state.repos.length || checksBusy.current) return
    const due = checksToPost(ch.roomId, state, messages)
    const links = linksToPost(ch.roomId, state)
    const issues = issuesToPost(ch.roomId, state)
    const closes = tasksToClose(ch.roomId, state)
    if (!due.length && !links.length && !issues.length && !closes.length) return
    checksBusy.current = true
    void (async () => {
      for (const c of due) {
        await ch.postReviewCheck(c).catch(() => {})
        setCheckedUpTo(ch.roomId, c.seq)
      }
      for (const l of links) {
        await ch.commentOnPr(l.repo, l.number, l.body).catch(() => {})
        setCheckedUpTo(ch.roomId, l.seq, "prLinks")
      }
      for (const i of issues) {
        await ch.closeIssue(i).catch(() => {})
        setCheckedUpTo(ch.roomId, i.seq, "issueCloses")
      }
      for (const c of closes) {
        const t = state.tasks.get(c.task)
        if (t) {
          const { body, opts } = closeFromGithub(t, c)
          await ch.send(body, opts).catch(() => {})
        }
        setCheckedUpTo(ch.roomId, c.seq, "issueTasks")
      }
    })().finally(() => {
      checksBusy.current = false
    })
  })
  useEffect(() => postReviewChecks(), [state.head, caughtUp])
  const redsBusy = useRef(false)
  const postCiReds = useEffectEvent(() => {
    if (!ch.isOwner || !caughtUp || !state.repos.length || redsBusy.current) return
    redsBusy.current = true
    const mark = { get: () => checkedUpTo(ch.roomId, "ciRed"), set: (seq: number) => setCheckedUpTo(ch.roomId, seq, "ciRed") }
    void import("../ci-red")
      .then((red) => red.postCiReds(ch, mark, state, messages))
      .catch(() => {})
      .finally(() => {
        redsBusy.current = false
      })
  })
  useEffect(() => postCiReds(), [state.head, caughtUp])
  const drainGithub = useEffectEvent(() => {
    if (ch.isOwner && state.repos.length) ch.drainGithub().catch(() => {})
  })
  useEffect(() => {
    drainGithub()
    const every = setInterval(drainGithub, 60_000)
    return () => clearInterval(every)
  }, [])
  const live = useMemo(() => new Map([...online].filter(([name, o]) => !!o.pk && keyOf.get(name) === o.pk && now - o.at < PRESENCE_TTL && howHere(o) !== null)), [online, keyOf, now])

  const chRef = useRef(ch)
  useEffect(() => {
    chRef.current = ch
  }, [ch])
  const send = useCallback(
    (body: string, opts: SendOptions) =>
      chRef.current.send(body, opts).catch((err: unknown) => {
        if (onGone(err)) throw new Error("you no longer have access to this channel", { cause: err })
        throw err
      }),
    [onGone]
  )

  const pkOf = useCallback((name: string) => keyOf.get(name), [keyOf])

  return { ch, connection, gone, messages, roster, state, online: live, isOwner, requests, send, refreshRequests, refreshRoster, head: start?.head ?? 0, marks, pkOf }
}

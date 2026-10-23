import * as Effect from "effect/Effect"
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import type { CachedRow } from "@kiwi/core/cache-row.ts"
import { ChannelGone } from "@kiwi/core/client/errors.ts"
import type { HumanSession, RoomsSetting, SendOptions } from "@kiwi/core/client.ts"
import type { JoinRequest, Member } from "@kiwi/core/membership.ts"
import { SNAPSHOT_TOO_LARGE, type Message } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type FoldBase, type GuardFloor, type Roster } from "@kiwi/core/state.ts"
import { errorOf, linkOf, watches, type ChannelLink, type FollowEvent } from "../channel-ops"
import { openCached, planCached, readKept, rememberKept, rememberRow, rememberRows } from "../history"
import { markOnce } from "../marks"
import { checksToPost, issuesToPost, linksToPost, setCheckedUpTo, tasksToClose } from "../review-checks"
import { drain } from "../github-queue"
import { closeFromGithub } from "../task-actions"
import { ICON_LIVE } from "../icon-event"
import { addMarks, type Marks } from "../receipts"
import { fork } from "../runtime"
import { noteSignInGone } from "../session"
import { nextSnapshotTry } from "../snapshot-plan"
import { untilOpen } from "../until-open"
import { useClock } from "./clock"
import { noteAgentWorked } from "./recent"
import { forgetChannel, loadMember, renameChannel, type StoredMember } from "./store"
import { hear, onlineByName, type Online } from "./online"
import { trimmed } from "./trim"
import { foldRoster } from "./fold-roster"
import { asKept, toKept } from "./kept"
import { handOver, onceEach, openChannel, warmUp } from "./open"
import { dropWarm, keepWarm, warmOf } from "./warm"

const HISTORY = 2_000
const KEEP_DELAY_MS = 3_000

type Connection = "connecting" | "live" | "reconnecting"

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
  snapshotTooBig: boolean
  ready: boolean
}

const merged = (prev: Message[], more: Message[]) => {
  const seen = new Set(prev.map((p) => p.seq))
  return [...prev, ...more.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq)
}

export function useChannel(member: StoredMember, human?: HumanSession | null): ChannelHandle {
  const ch = useMemo(() => linkOf(member), [member])
  const [was] = useState(() => warmOf(member.code))
  const [connection, setConnection] = useState<Connection>("connecting")
  const [ready, setReady] = useState(() => !!was)
  const [start, setStart] = useState<{ head: number; whole: boolean } | null>(null)
  const [gone, setGone] = useState<"removed" | "closed" | null>(null)
  const [messages, setMessages] = useState<Message[]>(was?.messages ?? [])
  const [unread, setUnread] = useState<number[]>(was?.unread ?? [])
  const [roster, setRoster] = useState<Member[]>(was?.roster ?? [])
  const [online, setOnline] = useState<ReadonlyMap<string, Online>>(new Map())
  const [marks, setMarks] = useState<Marks>(was?.marks ?? new Map())
  const [requests, setRequests] = useState<JoinRequest[]>(was?.requests ?? [])
  const now = useClock(15_000)
  const isOwner = ch.isOwner

  const [infoAt, setInfoAt] = useState(0)
  const [guardFloor, setGuardFloor] = useState<GuardFloor | null>(was?.guardFloor ?? null)
  const [roomsFloor, setRoomsFloor] = useState<RoomsSetting | null>(was?.roomsFloor ?? null)
  const [base, setBase] = useState<FoldBase | null>(was?.base ?? null)
  useEffect(() => {
    if (gone) dropWarm(member.code)
    else keepWarm(member.code, { messages, unread, roster, requests, marks, guardFloor, roomsFloor, base })
  }, [member.code, gone, messages, unread, roster, requests, marks, guardFloor, roomsFloor, base])
  useEffect(() => {
    if (!start || gone) return
    const t = setTimeout(() => {
      void ch
        .keep(toKept({ roster, base, guardFloor, roomsFloor }))
        .then((sealed) => (sealed ? rememberKept(ch.roomId, ch.pk, sealed) : undefined))
        .catch(() => {})
    }, KEEP_DELAY_MS)
    return () => clearTimeout(t)
  }, [ch, start, gone, roster, base, guardFloor, roomsFloor])
  const guardIn = useRef(false)
  const roomsIn = useRef(false)
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
    void guard.then(
      (g) => {
        guardIn.current = true
        setGuardFloor(g)
      },
      () => {}
    )
    void rooms.then(
      (r) => {
        roomsIn.current = true
        setRoomsFloor(r)
      },
      () => {}
    )
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

  const rosterIn = useRef(false)
  const refreshRoster = useCallback(async () => {
    try {
      setRoster(await ch.members())
      rosterIn.current = true
      if (ch.isOwner && (await ch.rotateIfDue())) setRoster(await ch.members())
    } catch (err) {
      onGone(err)
    }
  }, [ch, onGone])
  const loadRoster = useCallback(async () => {
    try {
      setRoster(await ch.members())
      rosterIn.current = true
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
        void rememberRows(
          ch.roomId,
          ch.pk,
          batch.flatMap((b) => (b.row ? [b.row] : [])),
          HISTORY
        ).catch(() => {})
      }, 30)
    }
    const onEvent = (ev: FollowEvent) => {
      switch (ev._tag) {
        case "Open":
          markOnce("kiwi:live")
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
        case "Unread":
          setUnread((prev) => [...prev, ev.seq].slice(-HISTORY))
          if (ev.row) void rememberRow(ch.roomId, ch.pk, ev.row, HISTORY).catch(() => {})
          return
        case "Presence":
          setOnline((prev) => hear(prev, ev.presence, Date.now()))
          return
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
    const early = new Set<number>()
    const earlyUnread = new Set<number>()
    let earlyBase = false
    let painted = false
    const steps = onceEach({
      head: () => ch.head(),
      roster: loadRoster,
      requests: refreshRequests,
      rotate: () => (ch.isOwner ? ch.rotateIfDue().catch((err: unknown) => (onGone(err), false)) : Promise.resolve(false)),
      cache: () => openCached(ch.roomId, ch.pk, ch.openRows).catch(() => null),
      plan: (opened, head) => planCached(ch.roomId, ch.pk, opened, head, HISTORY).catch(() => null),
      snapshot: () => ch.snapshot().catch(() => null),
      kept: async () => {
        const sealed = await readKept(ch.roomId, ch.pk).catch(() => null)
        return sealed ? asKept(await ch.openKept(sealed).catch(() => null)) : null
      },
      early: (cached, kept) => {
        if (closed || painted) return
        if (!rosterIn.current) setRoster(kept.roster)
        if (kept.base) {
          earlyBase = true
          setBase((prev) => prev ?? kept.base)
        }
        if (!guardIn.current) setGuardFloor(kept.guardFloor)
        if (!roomsIn.current) setRoomsFloor(kept.roomsFloor)
        if (cached?.unread.length) {
          const seen = cached.unread
          for (const seq of seen) earlyUnread.add(seq)
          setUnread((prev) => [...new Set([...prev, ...seen])].slice(-HISTORY))
        }
        if (cached?.messages.length) {
          const shown = cached.messages
          for (const m of shown) early.add(m.seq)
          setMessages((prev) => merged(prev, shown))
        }
        setReady(true)
      },
      paint: (cached, base) => {
        if (closed) return
        painted = true
        if (cached?.unread.length || earlyUnread.size) {
          const seen = cached?.unread ?? []
          setUnread((prev) =>
            handOver(
              prev.map((seq) => ({ seq })),
              earlyUnread,
              seen.map((seq) => ({ seq }))
            )
              .map((u) => u.seq)
              .slice(-HISTORY)
          )
        }
        if (cached?.messages.length || early.size) {
          const kept = cached?.messages ?? []
          setMessages((prev) => handOver(prev, early, kept))
          if (kept.some((m) => m.kind === "event" && m.ev?.op === "card")) noteAgentWorked()
        }
        if (base || earlyBase) setBase(base)
        setReady(true)
      },
    })
    warmUp(steps, was, HISTORY)
    const opening = untilOpen(
      Effect.tryPromise({
        try: () => openChannel(steps, was, HISTORY),
        catch: (err) => err,
      }),
      () => Effect.sync(() => setConnection("reconnecting"))
    )
    const stop = fork(
      opening.pipe(
        Effect.flatMap((opened) =>
          Effect.sync(() => {
            if (closed) return
            setStart({ head: opened.head, whole: opened.whole })
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
  }, [ch, refreshRoster, loadRoster, refreshRequests, onGone, human, member.code, was])

  const admitted = useMemo(() => roster.filter((m) => !m.unverified), [roster])
  const keyOf = useMemo(() => new Map(admitted.filter((r) => r.active).map((r) => [r.name, r.pk])), [admitted])
  const rosterForFold: Roster = useMemo(() => foldRoster(admitted), [admitted])
  const state = useMemo(() => fold(messages, rosterForFold, now, roomsFloor, guardFloor, base), [messages, rosterForFold, now, roomsFloor, guardFloor, base])
  const trim = useEffectEvent(() => {
    const next = trimmed(messages, rosterForFold, now, roomsFloor, guardFloor, base, HISTORY)
    if (!next) return
    setBase(next)
    setMessages((prev) => prev.filter((m) => m.seq > next.n))
    setUnread((prev) => prev.filter((seq) => seq > next.n))
  })
  useEffect(() => {
    const t = setTimeout(trim, 0)
    return () => clearTimeout(t)
  }, [messages.length])

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
  const [snapshotTooBig, setSnapshotTooBig] = useState(false)
  const snapshotIfDue = useEffectEvent(() => {
    const head = state.head
    if (!ch.isOwner || snapshotBusy.current || head < snapshotNext.current) return
    snapshotBusy.current = true
    ch.snapshotIfDue()
      .then(async (n) => {
        snapshotNext.current = nextSnapshotTry(head, n ?? (await ch.snapshotAt()) ?? 0)
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || !err.message.includes(SNAPSHOT_TOO_LARGE)) return
        snapshotNext.current = Infinity
        setSnapshotTooBig(true)
      })
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
      if (
        !(await drain(
          due,
          (c) => ch.postReviewCheck(c),
          (seq) => setCheckedUpTo(ch.roomId, seq)
        ))
      )
        return
      if (
        !(await drain(
          links,
          (l) => ch.commentOnPr(l.repo, l.number, l.body),
          (seq) => setCheckedUpTo(ch.roomId, seq, "prLinks")
        ))
      )
        return
      if (
        !(await drain(
          issues,
          (i) => ch.closeIssue(i),
          (seq) => setCheckedUpTo(ch.roomId, seq, "issueCloses")
        ))
      )
        return
      await drain(
        closes,
        async (c) => {
          const t = state.tasks.get(c.task)
          if (!t) return
          const { body, opts } = closeFromGithub(t, c)
          await ch.send(body, opts)
        },
        (seq) => setCheckedUpTo(ch.roomId, seq, "issueTasks")
      )
    })().finally(() => {
      checksBusy.current = false
    })
  })
  useEffect(() => postReviewChecks(), [state.head, caughtUp])
  const drainGithub = useEffectEvent(() => {
    if (ch.isOwner && state.repos.length) ch.drainGithub().catch(() => {})
  })
  useEffect(() => {
    drainGithub()
    const every = setInterval(drainGithub, 60_000)
    return () => clearInterval(every)
  }, [])
  const live = useMemo(() => onlineByName(online, keyOf, now), [online, keyOf, now])

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

  return { ch, connection, gone, messages, roster, state, online: live, isOwner, requests, send, refreshRequests, refreshRoster, head: start?.head ?? 0, marks, pkOf, snapshotTooBig, ready }
}

import { useEffect, useMemo, useRef, useState } from "react"

import type { HarnessRow } from "@kiwi/core/harnesses.ts"
import { capabilityLine, type Personality } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { useAutoApproval } from "@kiwi/app/auto-approval.ts"
import { parseHash } from "@kiwi/channel/hash.ts"
import { loadMember, loadPending } from "@kiwi/channel/store.ts"
import { useChannelList, type ChannelRow } from "@kiwi/channel/list.ts"
import { joinCodeFromLink } from "@kiwi/app/deep-link.ts"
import { adoptThisComputer } from "@kiwi/app/computers.ts"
import { useIcons, useMemberIcons } from "@kiwi/app/icons.ts"
import { lastChannel, rememberChannel, reopenable } from "@kiwi/app/last-channel.ts"
import { badgeTotal, newsTotal, rowNews, startMarks, useMarks, useOpenNews, useTabNews } from "@kiwi/channel/news.ts"
import { useOwnPersonalities } from "@kiwi/app/personalities.ts"
import { bridge, useSecrets } from "@kiwi/secrets/secrets.ts"
import { useAccount, useEnrolling, useGithubGate, useGithubSignIn } from "~/live/account"
import { makeActions } from "~/live/actions"
import { chime } from "~/live/alerts"
import { OpenMember, type View } from "~/live/channel"
import { iconUrl } from "~/live/icon"
import { useNotesElsewhere } from "~/live/notes"
import { hashTarget, messageOfLink } from "~/live/notify"
import { openFromNote } from "~/live/open-message"
import { harnessChoices } from "~/live/harness-rows"
import { OpenPending, pendingTitle } from "~/live/pending"
import { ownPrefs, usePrefs } from "~/live/prefs"
import { useComputer } from "~/live/computer"
import { useDeviceLists } from "~/live/devices"
import { useStarts } from "~/live/starts"
import { useGone, useOpened } from "~/live/store"
import type { App, ChannelTile } from "~/model"
import type { Go } from "~/nav"

const STATE: Record<ChannelRow["state"], ChannelTile["state"]> = { member: "member", pending: "waiting", agents: "gone", elsewhere: "gone" }

function useTiles(rows: ChannelRow[], notify: "all" | "mentions" | "none"): ChannelTile[] {
  const marks = useMarks()
  const openNews = useOpenNews()
  const icons = useIcons()
  const news = useMemo(() => rows.map((r) => rowNews(r, marks, openNews)), [rows, marks, openNews])
  useEffect(() => startMarks(rows), [rows])
  useTabNews(newsTotal(news), badgeTotal(news, notify))
  return useMemo(
    () =>
      rows.map((r, i): ChannelTile => {
        const n = news[i]
        const icon = iconUrl(icons.get(r.room))
        return {
          code: r.code,
          title: r.state === "pending" ? pendingTitle(r.code) : r.title,
          ...(icon ? { icon } : {}),
          state: STATE[r.state],
          unread: n ? (n.open ? n.count : n.fresh ? 1 : 0) : 0,
          needsYou: n?.needs ?? 0,
          last: r.ts,
        }
      }),
    [rows, news, icons]
  )
}

function useHarnesses(): App["harnesses"] {
  const [rows, setRows] = useState<HarnessRow[]>([])
  useEffect(() => {
    const b = bridge()
    if (!b) return
    let live = true
    const load = () =>
      void b.harnesses().then(
        (r) => live && setRows(r),
        () => {}
      )
    load()
    window.addEventListener("focus", load)
    return () => {
      live = false
      window.removeEventListener("focus", load)
    }
  }, [])
  return useMemo(() => harnessChoices(rows), [rows])
}

function usePersonas(own: Personality[]): App["personas"] {
  return useMemo(() => [...PRESETS, ...own].map((p) => ({ id: p.id, label: p.name, about: p.instructions.split(/(?<=\.)\s/)[0] ?? capabilityLine(p) })), [own])
}

const joinsMuted = (): boolean => ownPrefs().notify === "none"

function useDuties(rows: ChannelRow[], person: string | undefined, open: string | null) {
  useAutoApproval(rows, joinsMuted, chime)
  useNotesElsewhere(rows, open)
  const members = useMemo(() => rows.filter((r) => r.state === "member").map((r) => r.code), [rows])
  useMemberIcons(members)
  useDeviceLists(members)
  useEffect(() => {
    if (person) void adoptThisComputer().catch(() => {})
  }, [person])
}

export function useLive(open: string | null): App {
  const account = useAccount()
  const rows = useChannelList()
  const prefs = usePrefs()
  const channels = useTiles(rows, prefs.notify)
  useDuties(rows, useSecrets().person?.pk, open)
  const opened = useOpened()
  const harnesses = useHarnesses()
  const ownPersonalities = useOwnPersonalities()
  const personas = usePersonas(ownPersonalities)
  const starts = useStarts()
  const computer = useComputer()
  const enrolling = useEnrolling()
  const signIn = useGithubSignIn()
  const actions = useMemo(() => makeActions(), [])
  const channel = opened && opened.code === open ? opened.channel : null
  const lost = useGone()
  const gone = !channel && lost && lost.code === open ? lost : null
  return useMemo(
    () => ({ account, channels, channel, ...(gone ? { gone } : {}), prefs, harnesses, personas, starts, ownPersonalities, computer, enrolling, signIn, actions }),
    [account, channels, channel, gone, prefs, harnesses, personas, starts, ownPersonalities, computer, enrolling, signIn, actions]
  )
}

function useOpenLinks(go: (g: Go) => void, ready: boolean) {
  const take = useRef<(code: string) => void>(() => {})
  useEffect(() => {
    take.current = (code: string) => {
      if (loadMember(code) || loadPending(code)) return go({ to: "channel", code })
      go({ to: "invite", code })
    }
  }, [go])
  useEffect(() => {
    if (!ready) return
    const fromHash = () => {
      const { hash, seq } = hashTarget(location.hash)
      const { code } = parseHash(hash)
      if (!code) return
      history.replaceState(null, "", `${location.pathname}${location.search}`)
      if (seq) openFromNote(code, seq, take.current)
      else take.current(code)
    }
    fromHash()
    window.addEventListener("hashchange", fromHash)
    return () => window.removeEventListener("hashchange", fromHash)
  }, [ready])
  useEffect(() => {
    const b = bridge()
    if (!b || !ready) return
    const pick = () =>
      void b
        .getDeepLink()
        .then((url) => {
          const code = url ? joinCodeFromLink(url) : null
          if (!url || !code) return
          const seq = messageOfLink(url)
          if (seq) openFromNote(code, seq, take.current)
          else take.current(code)
        })
        .catch(() => {})
    pick()
    return b.onDeepLink(pick)
  }, [ready])
}

export function LiveDuties({ open, view, go }: { open: string | null; view: View; go: (g: Go) => void }) {
  const { person, channels } = useSecrets()
  const gate = useGithubGate()
  useOpenLinks(go, !!person && gate !== "needed" && gate !== "unknown")
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !person || !channels.length) return
    restored.current = true
    if (open) return
    const last = reopenable(
      lastChannel(),
      channels.flatMap((c) => (c.code && c.access && !c.relay ? [{ code: c.code, state: "member" }] : []))
    )
    if (last) go({ to: "channel", code: last })
  }, [person, channels, open, go])
  const member = useMemo(() => (open && channels ? loadMember(open) : null), [open, channels])
  const pending = useMemo(() => (open && channels && !member ? loadPending(open) : null), [open, channels, member])
  useEffect(() => {
    if (member) rememberChannel(member.code)
  }, [member])
  if (member && !member.relay) return <OpenMember key={member.code} member={member} view={view} />
  if (pending) return <OpenPending key={pending.code} pending={pending} />
  return null
}

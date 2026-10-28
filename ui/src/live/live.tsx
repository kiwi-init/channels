import { useEffect, useMemo, useRef, useState } from "react"

import type { HarnessRow } from "@kiwi/core/harnesses.ts"
import { capabilityLine, type Personality } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { useAutoApproval } from "@/lib/auto-approval"
import { loadMember, loadPending, parseHash, useChannelList, type ChannelRow } from "@/lib/channel"
import { joinCodeFromLink } from "@/lib/deep-link"
import { adoptThisComputer } from "@/lib/computers"
import { harnessName } from "@/lib/harness"
import { useIcons, useMemberIcons } from "@/lib/icons"
import { lastChannel, rememberChannel, reopenable } from "@/lib/last-channel"
import { newsTotal, rowNews, startMarks, useMarks, useOpenNews, useTabNews } from "@/lib/news"
import { useOwnPersonalities } from "@/lib/personalities"
import { bridge, useSecrets } from "@/lib/secrets"
import { useAccount } from "~/live/account"
import { makeActions } from "~/live/actions"
import { OpenMember, type View } from "~/live/channel"
import { iconUrl } from "~/live/icon"
import { harnessOf } from "~/live/map"
import { OpenPending, pendingTitle } from "~/live/pending"
import { usePrefs } from "~/live/prefs"
import { useStarts } from "~/live/starts"
import { useOpened } from "~/live/store"
import type { App, ChannelTile } from "~/model"
import type { Go } from "~/nav"

const STATE: Record<ChannelRow["state"], ChannelTile["state"]> = { member: "member", pending: "waiting", agents: "gone", elsewhere: "gone" }

function useTiles(rows: ChannelRow[]): ChannelTile[] {
  const marks = useMarks()
  const openNews = useOpenNews()
  const icons = useIcons()
  const news = useMemo(() => rows.map((r) => rowNews(r, marks, openNews)), [rows, marks, openNews])
  useEffect(() => startMarks(rows), [rows])
  useTabNews(newsTotal(news))
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
  return useMemo(() => {
    const out = new Map<string, App["harnesses"][number]>()
    for (const r of rows) {
      const id = harnessOf(r.harness)
      if (!id || id === "other" || out.has(id)) continue
      out.set(id, { id, label: harnessName(r.harness), installed: !!r.path && r.start })
    }
    return [...out.values()]
  }, [rows])
}

function usePersonas(own: Personality[]): App["personas"] {
  return useMemo(() => [...PRESETS, ...own].map((p) => ({ id: p.id, label: p.name, about: p.instructions.split(/(?<=\.)\s/)[0] ?? capabilityLine(p) })), [own])
}

function useDuties(rows: ChannelRow[], person: string | undefined) {
  useAutoApproval(rows)
  useMemberIcons(rows.filter((r) => r.state === "member").map((r) => r.code))
  useEffect(() => {
    if (person) void adoptThisComputer().catch(() => {})
  }, [person])
}

export function useLive(open: string | null): App {
  const account = useAccount()
  const rows = useChannelList()
  const channels = useTiles(rows)
  useDuties(rows, useSecrets().person?.pk)
  const opened = useOpened()
  const prefs = usePrefs()
  const harnesses = useHarnesses()
  const ownPersonalities = useOwnPersonalities()
  const personas = usePersonas(ownPersonalities)
  const starts = useStarts()
  const actions = useMemo(() => makeActions(), [])
  const channel = opened && opened.code === open ? opened.channel : null
  return useMemo(
    () => ({ account, channels, channel, prefs, harnesses, personas, starts, ownPersonalities, actions }),
    [account, channels, channel, prefs, harnesses, personas, starts, ownPersonalities, actions]
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
      const { code } = parseHash(location.hash)
      if (!code) return
      history.replaceState(null, "", `${location.pathname}${location.search}`)
      take.current(code)
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
          if (code) take.current(code)
        })
        .catch(() => {})
    pick()
    return b.onDeepLink(pick)
  }, [ready])
}

export function LiveDuties({ open, view, go }: { open: string | null; view: View; go: (g: Go) => void }) {
  const { person, channels } = useSecrets()
  useOpenLinks(go, !!person)
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

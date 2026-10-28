import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { handleFor } from "@kiwi/core/membership.ts"
import { relayUrl } from "@/lib/relay"
import { bridge, useSecrets, type ComputerView, type PhoneView } from "@/lib/secrets"
import { useUpdate } from "@/lib/update"
import { announce } from "~/kit/toasts"
import { store, type Listener } from "~/live/value"
import type { Account, Computer } from "~/model"
import { version } from "../../../package.json"

type PairAsk = NonNullable<Account["pairAsk"]>

interface Pairing {
  kind: PairAsk["kind"]
  stop: AbortController
}

const pairAsk = store<PairAsk | null>(null)
const github = store<{ login: string } | null>(null)
const githubCode = store<{ code: string; url: string } | null>(null)
let pairing: Pairing | null = null

const PAIR_POLL_MS = 1500

async function poll(p: Pairing): Promise<void> {
  const b = bridge()
  if (!b) return
  while (!p.stop.signal.aborted) {
    try {
      if (p.kind === "computer") {
        const ask = await b.pairPoll()
        if (ask && !p.stop.signal.aborted) return pairAsk.set({ kind: "computer", label: ask.label, os: ask.os })
      } else {
        const ask = await b.linkPoll()
        if (ask && !p.stop.signal.aborted) return pairAsk.set({ kind: "phone", label: ask.label, digits: ask.digits })
      }
    } catch (err) {
      if (p.stop.signal.aborted) return
      announce(`Pairing stopped: ${err instanceof Error ? err.message : String(err)}`)
      pairing = null
      return
    }
    await new Promise((r) => setTimeout(r, PAIR_POLL_MS))
  }
}

export async function pairBegin(kind: PairAsk["kind"]): Promise<string> {
  const b = bridge()
  if (!b) throw new Error("Pairing needs the Channels desktop app")
  await cancelPair()
  const { code } = kind === "computer" ? await b.pairBegin() : await b.linkBegin()
  const p: Pairing = { kind, stop: new AbortController() }
  pairing = p
  void poll(p)
  return code
}

export async function answerPair(accept: boolean): Promise<void> {
  const b = bridge()
  const p = pairing
  const ask = pairAsk.get()
  if (!b || !p || !ask) throw new Error("Nothing is asking to pair")
  pairing = null
  pairAsk.set(null)
  p.stop.abort()
  if (p.kind === "computer") {
    const r = await b.pairAnswer(accept)
    if (accept && r) announce(`Paired ${ask.label}`)
  } else {
    const r = await b.linkAnswer(accept)
    if (accept && r) announce(`Linked ${r.label}`)
  }
}

export async function cancelPair(): Promise<void> {
  const p = pairing
  pairing = null
  pairAsk.set(null)
  if (!p) return
  p.stop.abort()
  const b = bridge()
  if (b) await (p.kind === "computer" ? b.pairCancel() : b.linkCancel())
}

async function refreshGithub(): Promise<void> {
  const b = bridge()
  if (!b) return github.set(null)
  const s = await b.githubStatus()
  github.set(s.account ? { login: s.account.login } : null)
}

export async function linkGithub(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("Linking GitHub needs the Channels desktop app")
  const stop = b.onGithubCode((c) => {
    githubCode.set(c)
    void navigator.clipboard?.writeText(c.code).catch(() => {})
    announce(`Type ${c.code} on GitHub (copied)`)
    void b.openExternal(c.url).catch(() => {})
  })
  try {
    const s = await b.githubLink()
    github.set(s.account ? { login: s.account.login } : null)
    if (s.account) announce(`Linked GitHub as ${s.account.login}`)
  } finally {
    stop()
    githubCode.set(null)
  }
}

export async function unlinkGithub(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("Linking GitHub needs the Channels desktop app")
  const s = await b.githubUnlink()
  github.set(s.account ? { login: s.account.login } : null)
}

const OS: Record<string, Computer["os"]> = { macos: "mac", mac: "mac", darwin: "mac", linux: "linux", windows: "windows", win32: "windows" }

function computerOf(c: ComputerView, online: ReadonlyMap<string, boolean | null>, agents: number): Computer {
  return {
    id: c.machinePk,
    label: c.label,
    os: OS[c.os.toLowerCase()] ?? "linux",
    thisOne: !!c.own,
    online: online.get(c.machinePk) ?? !!c.own,
    agents: c.own ? agents : 0,
    lastSeen: c.at,
  }
}

const phoneOf = (p: PhoneView): Computer => ({ id: `phone:${p.at}`, label: p.label, os: /android/i.test(p.label) ? "android" : "iphone", thisOne: false, online: false, agents: 0, lastSeen: p.at })

function useMachines(): ReadonlyMap<string, boolean | null> {
  const [online, setOnline] = useState<ReadonlyMap<string, boolean | null>>(new Map())
  useEffect(() => {
    const b = bridge()
    if (!b) return
    let live = true
    const load = () =>
      void b.machines().then(
        (ms) => live && setOnline(new Map(ms.map((m) => [m.machinePk, m.online]))),
        () => {}
      )
    load()
    window.addEventListener("focus", load)
    return () => {
      live = false
      window.removeEventListener("focus", load)
    }
  }, [])
  return online
}

function useOwnAgents(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const b = bridge()
    if (!b) return
    let live = true
    const load = () =>
      void b.wakeSeats().then(
        (s) => live && setN(s.length),
        () => {}
      )
    load()
    window.addEventListener("focus", load)
    return () => {
      live = false
      window.removeEventListener("focus", load)
    }
  }, [])
  return n
}

const uiUpdate = (() => {
  let value: { version: string } | null = null
  const listeners = new Set<Listener>()
  let started = false
  const set = (next: { version: string } | null) => {
    value = next
    for (const l of listeners) l()
  }
  const start = () => {
    if (started) return
    started = true
    const b = bridge()
    if (!b?.getUiUpdate) return
    void b
      .getUiUpdate()
      .then(set)
      .catch(() => {})
    b.onUiUpdate(set)
  }
  return {
    get: () => value,
    subscribe: (l: Listener) => {
      start()
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
})()

export function useAccount(): Account | null {
  const { person, computers, phones } = useSecrets()
  const update = useUpdate()
  const online = useMachines()
  const agents = useOwnAgents()
  const linked = useSyncExternalStore(github.subscribe, github.get)
  const asking = useSyncExternalStore(pairAsk.subscribe, pairAsk.get)
  const code = useSyncExternalStore(githubCode.subscribe, githubCode.get)
  const look = useSyncExternalStore(uiUpdate.subscribe, uiUpdate.get)
  useEffect(() => {
    if (person) void refreshGithub().catch(() => {})
  }, [person])
  return useMemo((): Account | null => {
    if (!person) return null
    return {
      name: person.name,
      handle: handleFor(person.name),
      ...(linked ? { github: linked } : {}),
      computers: [...computers.map((c) => computerOf(c, online, agents)), ...phones.map(phoneOf)],
      version,
      ...(update && !update.blocked ? { update: { version: update.version, ready: update.state === "ready", state: update.state } } : {}),
      ...(look ? { uiUpdate: look } : {}),
      key: person.pk.slice(0, 8),
      relay: relayUrl(),
      ...(asking ? { pairAsk: asking } : {}),
      ...(code ? { githubCode: code } : {}),
    }
  }, [person, linked, computers, phones, online, agents, update, asking, code, look])
}

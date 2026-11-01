import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { handleFor } from "@kiwi/core/membership.ts"
import { useUnsealedKeys } from "@kiwi/secrets/keys-at-rest.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { bridge, useSecrets, type ComputerView, type DeviceNewsView, type PhoneView } from "@kiwi/secrets/secrets.ts"
import { useUpdate } from "@kiwi/app/update.ts"
import { announce } from "~/kit/toasts"
import { deviceNews, postDevicesNow } from "~/live/devices"
import { store, type Listener } from "~/live/value"
import type { Account, Computer, Device, EnrollAsk, Enrolling, GithubSignIn, RecoverySaved, RecoveryState } from "~/model"
import { version } from "../../../package.json"

const github = store<{ login: string } | null>(null)
const githubCode = store<{ code: string; url: string } | null>(null)
const githubGate = store<"unknown" | "needed" | "signed-in" | "off">("unknown")
const githubBusy = store<string | null>(null)
const githubMove = store<string | null>(null)
let codeListener: (() => void) | null = null

function listenForCodes(): void {
  const b = bridge()
  if (!b || codeListener) return
  codeListener = b.onGithubCode((c) => {
    githubCode.set(c)
    void navigator.clipboard?.writeText(c.code).catch(() => {})
    announce(`Type ${c.code} on GitHub (copied)`)
    void b.openExternal(c.url).catch(() => {})
  })
}

const ENROLL_POLL_MS = 20_000
const ENROLL_WAIT_MS = 2_000
const ENROLLING_MS = 2_000

const selfEnroll = store<Enrolling | null>(null)
let enrollTimer: ReturnType<typeof setTimeout> | null = null
let enrollRun: { done: (d: EnrollDone) => void } | null = null

export type EnrollDone = { person: { name: string }; channels: { label: string; code: string }[] }

const enrollBridge = () => {
  const b = bridge()
  if (!b?.enrollBegin) throw new Error("signing in as one of your devices works in the Channels desktop app")
  return b
}

export async function enrollBegin(signIn: () => Promise<unknown>, done: (d: EnrollDone) => void): Promise<void> {
  const b = enrollBridge()
  await signIn()
  await b.enrollBegin()
  if (enrollTimer) clearTimeout(enrollTimer)
  const mine = { done }
  enrollRun = mine
  selfEnroll.set({ stage: "asking" })
  const tick = async () => {
    enrollTimer = null
    let next: Awaited<ReturnType<typeof b.enrollStatus>>
    try {
      next = await b.enrollStatus()
    } catch (err) {
      if (enrollRun !== mine) return
      enrollRun = null
      selfEnroll.set(null)
      announce(`Couldn't sign in as one of your devices: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (enrollRun !== mine) return
    if (!next || next.stage === "gone" || next.stage === "done") {
      enrollRun = null
      selfEnroll.set(null)
      if (next?.stage === "gone") announce("Your other computer turned this one away, or the ask ran out")
      if (next?.stage === "done") done(next)
      return
    }
    if (JSON.stringify(selfEnroll.get()) !== JSON.stringify(next)) selfEnroll.set(next)
    if (next.stage === "check") return
    enrollTimer = setTimeout(() => void tick(), ENROLLING_MS)
  }
  enrollTimer = setTimeout(() => void tick(), ENROLLING_MS)
}

export async function enrollKeep(): Promise<void> {
  const mine = enrollRun
  if (selfEnroll.get()?.stage !== "check" || !mine) return
  enrollRun = null
  selfEnroll.set(null)
  mine.done(await enrollBridge().enrollKeep())
}

export async function enrollCancel(): Promise<void> {
  if (enrollTimer) clearTimeout(enrollTimer)
  enrollTimer = null
  enrollRun = null
  const shown = selfEnroll.get()
  selfEnroll.set(null)
  await enrollBridge().enrollCancel()
  if (shown?.stage === "check")
    announce(`Kept nothing. If your other computer never showed ${shown.person.fingerprint}, someone else answered this computer. It may still list this computer under Devices: remove it there.`)
}

export const enrollingNow = (): Enrolling | null => selfEnroll.get()

export const useEnrolling = (): Enrolling | null => useSyncExternalStore(selfEnroll.subscribe, enrollingNow)

const enrollTrouble = store<string | null>(null)

const enrollAsk = (() => {
  let value: EnrollAsk | null = null
  const listeners = new Set<Listener>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let started = false
  const set = (next: EnrollAsk | null) => {
    if (JSON.stringify(next) === JSON.stringify(value)) return
    value = next
    for (const l of listeners) l()
  }
  const check = async () => {
    if (timer) clearTimeout(timer)
    timer = null
    const b = bridge()
    if (!b?.enrollPoll) {
      if (b) enrollTrouble.set("this Channels app can't approve devices: update it")
      return
    }
    try {
      set(await b.enrollPoll())
      enrollTrouble.set(null)
    } catch (err) {
      // Not signed in, or the relay is unreachable: the next poll tries again, and the reason shows meanwhile.
      set(null)
      enrollTrouble.set(err instanceof Error ? err.message : String(err))
    }
    timer = setTimeout(() => void check(), value?.stage === "waiting" ? ENROLL_WAIT_MS : ENROLL_POLL_MS)
  }
  return {
    get: () => value,
    check,
    subscribe: (l: Listener) => {
      listeners.add(l)
      if (!started) {
        started = true
        window.addEventListener("focus", () => void check())
        void check()
      }
      return () => void listeners.delete(l)
    },
  }
})()

const devices = (() => {
  let value: Device[] | null = null
  const listeners = new Set<Listener>()
  let started = false
  const load = async () => {
    const b = bridge()
    if (!b?.devices) return
    try {
      const got = await b.devices()
      value = got ? got.map((d) => ({ id: d.id, label: d.label, os: d.os, as: d.as, until: d.until, thisOne: d.thisOne })) : null
    } catch {
      // Not signed in, or the relay is unreachable: the list shows what it last showed, and focus loads it again.
      return
    }
    for (const l of listeners) l()
  }
  return {
    get: () => value,
    load,
    subscribe: (l: Listener) => {
      listeners.add(l)
      if (!started) {
        started = true
        window.addEventListener("focus", () => void load())
        void load()
      }
      return () => void listeners.delete(l)
    },
  }
})()

function deviceNotices(news: DeviceNewsView | null): Pick<Account, "forgotten" | "forgotHere"> {
  if (!news) return {}
  const older = news.revokes.filter((r) => r.older).map((r) => ({ label: r.label, by: r.by, at: r.at }))
  return { ...(older.length ? { forgotten: older } : {}), ...(news.removed && !news.removed.wiped ? { forgotHere: { by: news.removed.by } } : {}) }
}

export async function forgetDevice(id: string): Promise<void> {
  const b = bridge()
  if (!b?.forgetDevice) throw new Error("forgetting a device needs the next Channels update")
  await b.forgetDevice(id)
  await devices.load()
  postDevicesNow()
}

export async function renewDevice(id: string): Promise<void> {
  const b = bridge()
  if (!b?.renewDevice) throw new Error("renewing a device needs the next Channels update")
  await b.renewDevice(id)
  await devices.load()
  postDevicesNow()
}

const recovery = (() => {
  let value: RecoveryState | null = null
  const listeners = new Set<Listener>()
  let started = false
  const load = async () => {
    const b = bridge()
    if (!b?.recovery) return
    try {
      value = await b.recovery()
    } catch {
      // Not signed in, or the relay is unreachable: the page shows what it last showed, and focus loads it again.
      return
    }
    for (const l of listeners) l()
  }
  return {
    get: () => value,
    load,
    subscribe: (l: Listener) => {
      listeners.add(l)
      if (!started) {
        started = true
        window.addEventListener("focus", () => void load())
        void load()
      }
      return () => void listeners.delete(l)
    },
  }
})()

const recovering = () => {
  const b = bridge()
  if (!b?.recoveryWords) throw new Error("a recovery key needs the next Channels update")
  return b
}

export const recoveryWords = (): Promise<string[]> => recovering().recoveryWords()

export async function recoverySave(typed: { at: number; word: string }[]): Promise<RecoverySaved> {
  const r = await recovering().recoverySave(typed)
  if (!r.ok) return r
  announce("Recovery key set up")
  await recovery.load()
  return { ok: true }
}

export const recoveryDrop = (): Promise<void> => recovering().recoveryDrop()

const enrolling = () => {
  const b = bridge()
  if (!b?.enrollPoll) throw new Error("approving a device needs the next Channels update")
  return b
}

export async function enrollAnswer(id: string): Promise<void> {
  await enrolling().enrollAnswer(id)
  await enrollAsk.check()
}

export async function enrollConfirm(id: string, digits: string): Promise<{ ok: true } | { ok: false; left: number }> {
  const r = await enrolling().enrollConfirm(id, digits)
  if (r.ok) {
    announce(`${r.label} is one of your devices now`)
    await devices.load()
  } else if (r.left === 0) announce("Turned it away: the digits didn't match")
  await enrollAsk.check()
  return r.ok ? { ok: true } : { ok: false, left: r.left }
}

export async function enrollDeny(id: string): Promise<void> {
  await enrolling().enrollDeny(id)
  await enrollAsk.check()
}

async function refreshGithub(): Promise<void> {
  const b = bridge()
  if (!b) {
    github.set(null)
    return githubGate.set("off")
  }
  listenForCodes()
  const s = await b.githubStatus()
  github.set(s.account ? { login: s.account.login } : null)
  githubGate.set(!s.signIn ? "off" : s.account ? "signed-in" : "needed")
  githubMove.set(s.moveRefused ?? null)
}

export async function linkGithub(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("Linking GitHub needs the Channels desktop app")
  listenForCodes()
  githubBusy.set(null)
  try {
    const s = await b.githubLink()
    github.set(s.account ? { login: s.account.login } : null)
    if (s.signIn) githubGate.set(s.account ? "signed-in" : "needed")
    githubMove.set(s.moveRefused ?? null)
    if (s.account) announce(`Signed in with GitHub as ${s.account.login}`)
  } catch (err) {
    githubBusy.set(err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    githubCode.set(null)
  }
}

/** Where signing in with GitHub stands, on a relay that takes it; null on one that doesn't. */
export function useGithubSignIn(): GithubSignIn | null {
  const gate = useSyncExternalStore(githubGate.subscribe, githubGate.get)
  const linked = useSyncExternalStore(github.subscribe, github.get)
  const code = useSyncExternalStore(githubCode.subscribe, githubCode.get)
  const problem = useSyncExternalStore(githubBusy.subscribe, githubBusy.get)
  useEffect(() => {
    void refreshGithub().catch(() => githubGate.set("off"))
  }, [])
  return useMemo((): GithubSignIn | null => {
    if (gate === "unknown") return { stage: "checking" }
    if (gate === "needed") return { stage: "sign-in", code, problem }
    if (gate === "signed-in" && linked) return { stage: "signed-in", login: linked.login }
    return null
  }, [gate, linked, code, problem])
}

/** Whether the app waits on GitHub sign-in (or doesn't know yet whether it does). */
export const useGithubGate = (): "unknown" | "needed" | "signed-in" | "off" => useSyncExternalStore(githubGate.subscribe, githubGate.get)

export const useGithubLogin = (): string | null => useSyncExternalStore(github.subscribe, () => github.get()?.login ?? null)

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

const phoneOf = (p: PhoneView): Computer => ({
  id: `phone:${p.at}`,
  label: p.label,
  os: /android/i.test(p.label) ? "android" : "iphone",
  thisOne: false,
  online: false,
  agents: 0,
  lastSeen: p.at,
  ...(p.channels ? { holds: p.channels } : {}),
})

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
  const code = useSyncExternalStore(githubCode.subscribe, githubCode.get)
  const gate = useSyncExternalStore(githubGate.subscribe, githubGate.get)
  const moveRefused = useSyncExternalStore(githubMove.subscribe, githubMove.get)
  const look = useSyncExternalStore(uiUpdate.subscribe, uiUpdate.get)
  const enroll = useSyncExternalStore(enrollAsk.subscribe, enrollAsk.get)
  const trouble = useSyncExternalStore(enrollTrouble.subscribe, enrollTrouble.get)
  const signed = useSyncExternalStore(devices.subscribe, devices.get)
  const kept = useSyncExternalStore(recovery.subscribe, recovery.get)
  const news = useSyncExternalStore(deviceNews.subscribe, deviceNews.get)
  const unsealed = useUnsealedKeys()
  useEffect(() => {
    if (person) void refreshGithub().catch(() => {})
  }, [person])
  return useMemo((): Account | null => {
    if (!person) return null
    return {
      name: person.name,
      handle: handleFor(person.name),
      ...(linked ? { github: linked } : {}),
      ...(gate === "signed-in" ? { githubSignIn: true } : {}),
      ...(moveRefused ? { githubMove: moveRefused } : {}),
      computers: [...computers.map((c) => computerOf(c, online, agents)), ...phones.map(phoneOf)],
      version,
      ...(update
        ? {
            update: {
              version: update.version,
              ready: update.state === "ready",
              state: update.state,
              ...(update.state === "downloading" && update.progress !== undefined ? { progress: update.progress } : {}),
              ...(update.blocked ? { blocked: true as const } : {}),
            },
          }
        : {}),
      ...(look ? { uiUpdate: look } : {}),
      key: person.pk.slice(0, 8),
      personPk: person.pk,
      relay: relayUrl(),
      ...(unsealed ? { keysUnsealed: true } : {}),
      ...(bridge() ? { desktop: true } : {}),
      ...(enroll ? { enrollAsk: enroll } : {}),
      ...(trouble ? { enrollError: trouble } : {}),
      ...(signed ? { devices: signed } : {}),
      ...(kept ? { recovery: kept } : {}),
      ...deviceNotices(news),
      ...(code ? { githubCode: code } : {}),
    }
  }, [person, linked, gate, moveRefused, computers, phones, online, agents, update, code, look, unsealed, enroll, trouble, signed, kept, news])
}

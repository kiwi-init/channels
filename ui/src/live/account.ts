import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { handleFor } from "@kiwi/core/membership.ts"
import { useUnsealedKeys } from "@kiwi/secrets/keys-at-rest.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { bridge, useSecrets, type ComputerView, type DeviceNewsView, type MovedView, type PhoneView } from "@kiwi/secrets/secrets.ts"
import { useUpdate } from "@kiwi/app/update.ts"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import { deviceNews } from "~/live/devices"
import { store, type Listener } from "~/live/value"
import type { Account, Computer, Device, EnrollAsk, Enrolling, GithubSignIn } from "~/model"
import { version } from "../../../package.json"

export const github = store<{ login: string } | null>(null)
export const githubCode = store<{ code: string; url: string } | null>(null)
export const githubGate = store<"unknown" | "needed" | "signed-in" | "off">("unknown")
export const githubBusy = store<string | null>(null)
let codeListener: (() => void) | null = null

export function listenForCodes(): void {
  const b = bridge()
  if (!b || codeListener) return
  codeListener = b.onGithubCode((c) => {
    githubCode.set(c)
    void navigator.clipboard?.writeText(c.code).catch(() => {})
    announce(t("live.account.github.code", { code: c.code }))
    void b.openExternal(c.url).catch(() => {})
  })
}

const ENROLL_POLL_MS = 20_000
const ENROLL_WAIT_MS = 2_000
export const selfEnroll = store<Enrolling | null>(null)
export const enrollingNow = (): Enrolling | null => selfEnroll.get()

export const useEnrolling = (): Enrolling | null => useSyncExternalStore(selfEnroll.subscribe, enrollingNow)

const enrollTrouble = store<string | null>(null)

export const enrollAsk = (() => {
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
      if (b) enrollTrouble.set(t("live.account.cant.approve"))
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

export const devices = (() => {
  let value: Device[] | null = null
  const listeners = new Set<Listener>()
  let started = false
  const load = async () => {
    const b = bridge()
    if (!b?.devices) return
    try {
      const got = await b.devices()
      value = got ? got.map((d) => ({ id: d.id, label: d.label, os: d.os, as: d.as, until: d.until, thisOne: d.thisOne, ...(d.app ? { app: d.app } : {}) })) : null
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

export const moved = (() => {
  const value = store<MovedView | null>(null)
  let started = false
  return {
    get: value.get,
    set: value.set,
    subscribe: (l: Listener) => {
      if (!started) {
        started = true
        const b = bridge()
        if (b && typeof b.movedApp === "function")
          void b
            .movedApp()
            .then(value.set)
            .catch(() => {})
      }
      return value.subscribe(l)
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
  const look = useSyncExternalStore(uiUpdate.subscribe, uiUpdate.get)
  const home = useSyncExternalStore(moved.subscribe, moved.get)
  const enroll = useSyncExternalStore(enrollAsk.subscribe, enrollAsk.get)
  const trouble = useSyncExternalStore(enrollTrouble.subscribe, enrollTrouble.get)
  const signed = useSyncExternalStore(devices.subscribe, devices.get)
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
      ...(home ? { moved: home } : {}),
      key: person.pk.slice(0, 8),
      personPk: person.pk,
      relay: relayUrl(),
      ...(unsealed ? { keysUnsealed: true } : {}),
      ...(bridge() ? { desktop: true } : {}),
      ...(enroll ? { enrollAsk: enroll } : {}),
      ...(trouble ? { enrollError: trouble } : {}),
      ...(signed ? { devices: signed } : {}),
      ...deviceNotices(news),
      ...(code ? { githubCode: code } : {}),
    }
  }, [person, linked, gate, computers, phones, online, agents, update, code, look, home, unsealed, enroll, trouble, signed, news])
}

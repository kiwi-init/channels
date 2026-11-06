import { bridge, secrets } from "@kiwi/secrets/secrets.ts"
import { launchedBy } from "@kiwi/app/forgotten-computers.ts"
import { announce } from "~/kit/toasts"
import { devices, enrollAsk, github, githubBusy, githubCode, githubGate, listenForCodes, moved, selfEnroll } from "~/live/account"
import { postDevicesNow } from "~/live/devices"
import { downloadAndRestart } from "~/live/update"
import type { KeptAgent, LaunchedAgent } from "~/model"

const ENROLLING_MS = 2_000

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
      announce(`Couldn't sign in as one of your devices: ${err instanceof Error ? err.message : String(err)}`, "error")
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

export async function launchedFrom(ids: readonly string[]): Promise<LaunchedAgent[]> {
  const person = secrets().person?.pk
  if (!person) return []
  const [{ allMembers }, { linkOf }] = await Promise.all([import("@kiwi/channel/store.ts"), import("@kiwi/channel/channel-ops.ts")])
  const rosters = await Promise.all(
    allMembers().map(async (m) => {
      const roster = await linkOf(m)
        .members()
        .catch(() => [])
      return launchedBy(roster, ids, person).map((a) => ({ ...a, code: m.code }))
    })
  )
  return rosters.flat()
}

export async function forgetDevice(ids: readonly string[], keep: readonly KeptAgent[] = []): Promise<void> {
  const b = bridge()
  if (!b?.forgetDevice) throw new Error("forgetting a device needs the next Channels update")
  if (keep.length) {
    if (!b.keepAgents) throw new Error("keeping its agents needs the next Channels update")
    const { keepAgents } = await import("@kiwi/app/device-lists.ts")
    for (const code of new Set(keep.map((k) => k.code))) {
      const got = await b.keepAgents(
        code,
        keep.filter((k) => k.code === code).map(({ pk, from }) => ({ pk, from }))
      )
      if (!got) throw new Error("this computer isn't on your list of devices, so it can't take the agents over")
      keepAgents(code, got.links, got.keep)
    }
  }
  for (const id of ids) await b.forgetDevice(id)
  await devices.load()
  postDevicesNow()
}

export async function renewDevice(...ids: string[]): Promise<void> {
  const b = bridge()
  if (!b?.renewDevice) throw new Error("renewing a device needs the next Channels update")
  for (const id of ids) await b.renewDevice(id)
  await devices.load()
  postDevicesNow()
}

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
  } else if (r.left === 0) announce("Turned it away: the digits didn't match", "error")
  await enrollAsk.check()
  return r.ok ? { ok: true } : { ok: false, left: r.left }
}

export async function enrollDeny(id: string): Promise<void> {
  await enrolling().enrollDeny(id)
  await enrollAsk.check()
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
    if (s.account) announce(`Signed in with GitHub as ${s.account.login}`)
  } catch (err) {
    githubBusy.set(err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    githubCode.set(null)
  }
}

export async function unlinkGithub(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("Linking GitHub needs the Channels desktop app")
  const s = await b.githubUnlink()
  github.set(s.account ? { login: s.account.login } : null)
}

export async function dismissMoved(): Promise<void> {
  moved.set(null)
  const b = bridge()
  if (b && typeof b.dismissMovedApp === "function") await b.dismissMovedApp()
}

export async function setRelay(url: string): Promise<string | null> {
  const b = bridge()
  if (!b) return "only the desktop app can change its relay"
  try {
    await b.setRelayUrl(url.trim())
    return null
  } catch (err) {
    return err instanceof Error ? err.message.replace(/^.*?Error: /, "") : String(err)
  }
}

export async function installUpdate(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("updates come with the Channels desktop app")
  await downloadAndRestart(b, announce)
}

export async function applyUi(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("the new look comes with the Channels desktop app")
  await b.applyUi()
}

export async function signOut(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("only the desktop app keeps a sign-in")
  await b.signOut()
  announce("Signed out of the relay. Your key and channels stay on this computer")
}

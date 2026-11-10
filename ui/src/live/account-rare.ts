import "~/i18n/en/live-later"
import { bridge, secrets } from "@kiwi/secrets/secrets.ts"
import { launchedBy } from "@kiwi/app/forgotten-computers.ts"
import { t } from "~/i18n/i18n"
import { Plain } from "~/kit/failed"
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
  if (!b?.enrollBegin) throw new Error(t("live.account.enroll.desktop"))
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
      announce(t("live.account.enroll.failed", { why: err instanceof Error ? err.message : String(err) }), "error")
      return
    }
    if (enrollRun !== mine) return
    if (!next || next.stage === "gone" || next.stage === "done") {
      enrollRun = null
      selfEnroll.set(null)
      if (next?.stage === "gone") announce(t("live.account.enroll.gone"), "error")
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
  if (shown?.stage === "check") announce(t("live.account.kept.nothing", { fingerprint: shown.person.fingerprint }), "error")
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
  if (!b?.forgetDevice) throw new Error(t("live.account.forget.needs.update"))
  if (keep.length) {
    if (!b.keepAgents) throw new Error(t("live.account.keep.needs.update"))
    const { keepAgents } = await import("@kiwi/app/device-lists.ts")
    for (const code of new Set(keep.map((k) => k.code))) {
      const got = await b.keepAgents(
        code,
        keep.filter((k) => k.code === code).map(({ pk, from }) => ({ pk, from }))
      )
      if (!got) throw new Error(t("live.account.not.a.device"))
      keepAgents(code, got.links, got.keep)
    }
  }
  for (const id of ids) await b.forgetDevice(id)
  await devices.load()
  postDevicesNow()
}

export async function renewDevice(...ids: string[]): Promise<void> {
  const b = bridge()
  if (!b?.renewDevice) throw new Error(t("live.account.renew.needs.update"))
  for (const id of ids) await b.renewDevice(id)
  await devices.load()
  postDevicesNow()
}

const enrolling = () => {
  const b = bridge()
  if (!b?.enrollPoll) throw new Error(t("live.account.approve.needs.update"))
  return b
}

export async function enrollAnswer(id: string): Promise<void> {
  await enrolling().enrollAnswer(id)
  await enrollAsk.check()
}

export async function enrollConfirm(id: string, digits: string): Promise<{ ok: true } | { ok: false; left: number }> {
  const r = await enrolling().enrollConfirm(id, digits)
  if (r.ok) {
    announce(t("live.account.device.added", { label: r.label }))
    await devices.load()
  } else if (r.left === 0) announce(t("live.account.digits.mismatch"), "error")
  await enrollAsk.check()
  return r.ok ? { ok: true } : { ok: false, left: r.left }
}

export async function enrollDeny(id: string): Promise<void> {
  await enrolling().enrollDeny(id)
  await enrollAsk.check()
}

export async function linkGithub(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error(t("live.account.github.desktop"))
  listenForCodes()
  githubBusy.set(null)
  try {
    const s = await b.githubLink()
    github.set(s.account ? { login: s.account.login } : null)
    if (s.signIn) githubGate.set(s.account ? "signed-in" : "needed")
    if (s.account) announce(t("live.account.github.signed.in", { login: s.account.login }))
  } catch (err) {
    githubBusy.set(err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    githubCode.set(null)
  }
}

export async function unlinkGithub(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error(t("live.account.github.desktop"))
  const s = await b.githubUnlink()
  github.set(s.account ? { login: s.account.login } : null)
}

export async function dismissMoved(): Promise<void> {
  moved.set(null)
  const b = bridge()
  if (b && typeof b.dismissMovedApp === "function") await b.dismissMovedApp()
}

export async function setRelay(url: string): Promise<void> {
  const b = bridge()
  if (!b) throw new Plain(t("live.account.relay.desktop"))
  try {
    await b.setRelayUrl(url.trim())
  } catch (err) {
    // The app's own refusal of the address is said in words; anything else keeps its raw text for Details.
    if (/isn't a relay URL/i.test(err instanceof Error ? err.message : String(err))) throw new Plain(t("live.account.relay.not.url"))
    throw err
  }
}

export async function installUpdate(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error(t("live.account.updates.desktop"))
  await downloadAndRestart(b, announce)
}

export async function applyUi(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error(t("live.account.new.look.desktop"))
  await b.applyUi()
}

export async function signOut(): Promise<void> {
  const b = bridge()
  if (!b) throw new Error(t("live.account.sign.in.desktop"))
  await b.signOut()
  announce(t("live.account.signed.out"))
}

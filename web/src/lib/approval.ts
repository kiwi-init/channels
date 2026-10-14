// Background approval: every channel this app owns is watched for join requests. A request from
// one of the person's own computers (its computer claim names this person key) is let in on its
// own, as an agent sponsored by the person (Channel.autoApprove); anything else gets a notification,
// once, so the person can open the channel and decide.

import { useEffect, useEffectEvent } from "react"

import { Channel } from "@mc/client.ts"

import { loadMember, saveMember, type ChannelRow } from "./channel"
import { relayUrl } from "./relay"
import { bridge, secrets } from "./secrets"

const EVERY_MS = 20_000

/** Requests already announced, so each is notified once per run of the app. */
const told = new Set<string>()

function notify(title: string, body: string) {
  const b = bridge()
  if (b) return void b.notify(title, body).catch(() => {})
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body })
}

/** One pass over one owned channel: approve own computers' agents, announce the rest. */
async function tend(code: string, person: string): Promise<void> {
  const m = loadMember(code)
  if (!m || m.identity.pk !== m.access.ownerPk) return
  const ch = new Channel(m.access, relayUrl(), m.identity, (access) => saveMember({ ...(loadMember(code) ?? m), access }))
  const title = m.name ?? "your channel"
  const let_in = await ch.autoApprove(person)
  if (let_in.length) notify(title, let_in.length === 1 ? `${let_in[0]!.name} joined from your computer` : `${let_in.length} of your agents joined`)
  for (const r of await ch.requests({ person })) {
    if (r.computer?.own || told.has(r.id)) continue
    told.add(r.id)
    notify(title, `${r.name} asks to join`)
  }
}

/** Watch every owned channel in `rows` while the app runs (the tray keeps it running when closed). */
export function useAutoApproval(rows: ChannelRow[]): void {
  const owned = rows.filter((r) => r.owner && r.state === "member").map((r) => r.code)
  const key = owned.join(" ")
  const pass = useEffectEvent(async () => {
    const person = secrets().person?.pk
    if (!person) return
    for (const code of owned) await tend(code, person).catch(() => {})
  })
  useEffect(() => {
    if (!key) return
    let stop = false
    let timer: number | undefined
    const loop = async () => {
      await pass()
      if (!stop) timer = window.setTimeout(loop, EVERY_MS)
    }
    void loop()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [key])
}

// Background approval: every channel this app owns is watched for join requests. A request from
// one of the person's own computers (its computer claim names this person key) is let in on its
// own, as an agent sponsored by the person (Channel.autoApprove); anything else gets a notification,
// once, so the person can open the channel and decide.

import { useEffect } from "react"

import { tendOnPush, tendOwned } from "./approval-tend"
import { loadMember, type ChannelRow } from "./channel"
import { linkOf, watches } from "./channel-ops"
import { bridge, secrets } from "./secrets"

const EVERY_MS = 300_000

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
  const ch = linkOf(m)
  await tendOwned(person, m.name ?? "your channel", ch, notify, told)
}

/** Watch every owned channel in `rows` while the app runs (the tray keeps it running when closed). */
export function useAutoApproval(rows: ChannelRow[]): void {
  const owned = rows.filter((r) => r.owner && r.state === "member").map((r) => r.code)
  const key = owned.join(" ")
  useEffect(() => {
    if (!key) return
    const codes = key.split(" ")
    const tending = tendOnPush(codes, watches().watch, async (code) => {
      const person = secrets().person?.pk
      if (person) await tend(code, person)
    })
    const timer = window.setInterval(() => {
      for (const code of codes) tending.kick(code)
    }, EVERY_MS)
    return () => {
      tending.stop()
      clearInterval(timer)
    }
  }, [key])
}

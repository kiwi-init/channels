// Background approval: every channel this app owns is watched for join requests. A request from
// one of the person's own computers (its computer claim names this person key) is let in on its
// own, as an agent sponsored by the person (Channel.autoApprove); anything else gets a notification,
// once, so the person can open the channel and decide.

import { TEND_SAFETY_MS, tendOnPush, tendOwned } from "./approval-tend"
import { loadMember } from "./channel"
import { linkOf, watches } from "./channel-ops"
import { tendLists } from "./device-lists"
import { followedLaunches, sawMembers, sawRequests } from "./launch-follow"
import { bridge, secrets } from "./secrets"

/** Requests already announced, so each is notified once per run of the app. */
const told = new Set<string>()

function notify(title: string, body: string) {
  const b = bridge()
  if (b) return void b.notify(title, body).catch(() => {})
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body })
}

async function ownLinks() {
  const b = bridge()
  if (!b?.deviceNews) return []
  return (await b.deviceNews().catch(() => null))?.links ?? []
}

/** One pass over one owned channel: cut forgotten devices, approve own computers' agents, announce the rest. */
async function tend(code: string, person: string | undefined): Promise<void> {
  const m = loadMember(code)
  if (!m || m.identity.pk !== m.access.ownerPk) return
  const ch = linkOf(m)
  const title = m.name ?? "your channel"
  const { lists, cut } = await tendLists(code, await ownLinks(), ch).catch(() => ({ lists: undefined, cut: [] }))
  const one = cut[0]
  if (one) notify(title, cut.length === 1 ? `${one.name} is out: the device was forgotten` : `${cut.length} members are out: their devices were forgotten`)
  if (!person) return
  const [{ PRESETS }, { cleanPersonalities }] = await Promise.all([import("@kiwi/core/presets.ts"), import("@kiwi/core/personalities.ts")])
  const personalities = [...PRESETS, ...cleanPersonalities(secrets().personalities)]
  if (followedLaunches(code).length) sawRequests(code, await ch.requests({ person, ...(lists ? { lists } : {}) }).catch(() => []))
  const api = {
    autoApprove: async (p: string) => {
      const members = await ch.autoApprove(p, personalities, null, lists)
      sawMembers(code, members)
      return members
    },
    requests: (o: { person: string }) => ch.requests({ ...o, ...(lists ? { lists } : {}) }),
  }
  await tendOwned(person, title, api, notify, told)
}

/** Watch every owned channel in `rows` while the app runs (the tray keeps it running when closed). */
export function startAutoApproval(codes: string[]): () => void {
  const tending = tendOnPush(codes, watches().watch, (code) => tend(code, secrets().person?.pk))
  const timer = window.setInterval(() => {
    for (const code of codes) tending.kick(code)
  }, TEND_SAFETY_MS)
  return () => {
    tending.stop()
    clearInterval(timer)
  }
}

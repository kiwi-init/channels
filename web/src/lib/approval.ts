// Background approval: every channel this app owns is watched for join requests. A request from
// one of the person's own computers (its computer claim names this person key) is let in on its
// own, as an agent sponsored by the person (Channel.autoApprove); anything else gets a notification,
// once, so the person can open the channel and decide.

import { TEND_SAFETY_MS, tendOnPush, tendOwned } from "./approval-tend"
import { loadMember } from "./channel"
import { linkOf, watches } from "./channel-ops"
import { followedLaunches, sawMembers, sawRequests } from "./launch-follow"
import { bridge, secrets } from "./secrets"

/** Requests already announced, so each is notified once per run of the app. */
const told = new Set<string>()

function notify(title: string, body: string, code: string) {
  const b = bridge()
  if (b) return void b.notify(title, body, `kiwi://join/${encodeURIComponent(code)}`).catch(() => {})
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  const note = new Notification(title, { body })
  note.onclick = () => {
    window.focus()
    location.hash = encodeURIComponent(code)
    note.close()
  }
}

/** One pass over one owned channel: approve own computers' agents, announce the rest. */
async function tend(code: string, person: string, muted: () => boolean): Promise<void> {
  const m = loadMember(code)
  if (!m || m.identity.pk !== m.access.ownerPk) return
  const ch = linkOf(m)
  const [{ PRESETS }, { cleanPersonalities }] = await Promise.all([import("@kiwi/core/presets.ts"), import("@kiwi/core/personalities.ts")])
  const personalities = [...PRESETS, ...cleanPersonalities(secrets().personalities)]
  if (followedLaunches(code).length) sawRequests(code, await ch.requests({ person }).catch(() => []))
  const api = {
    autoApprove: async (p: string) => {
      const members = await ch.autoApprove(p, personalities)
      sawMembers(code, members)
      return members
    },
    requests: (o: { person: string }) => ch.requests(o),
  }
  await tendOwned(person, m.name ?? "your channel", api, (title, body) => (muted() ? undefined : notify(title, body, code)), told)
}

/** Watch every owned channel in `rows` while the app runs (the tray keeps it running when closed). */
export function startAutoApproval(codes: string[], muted: () => boolean = () => false): () => void {
  const tending = tendOnPush(codes, watches().watch, async (code) => {
    const person = secrets().person?.pk
    if (person) await tend(code, person, muted)
  })
  const timer = window.setInterval(() => {
    for (const code of codes) tending.kick(code)
  }, TEND_SAFETY_MS)
  return () => {
    tending.stop()
    clearInterval(timer)
  }
}

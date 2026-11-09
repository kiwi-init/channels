import "~/i18n/en/live-later"
import { handleFor } from "@kiwi/core/membership.ts"
import { ROBOT_FACES } from "@kiwi/core/protocol.ts"
import { tokenForCreate } from "@kiwi/app/auth.ts"
import { askToJoin, createChannel, inviteInfo } from "@kiwi/channel/join.ts"
import { isJoinCode, loadMember, loadPending } from "@kiwi/channel/store.ts"
import { linkOf } from "@kiwi/channel/channel-ops.ts"
import { joinCodeFromLink } from "@kiwi/app/deep-link.ts"
import { bridge, secrets } from "@kiwi/secrets/secrets.ts"
import { isSignInGone } from "@kiwi/channel/session.ts"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import type { EnrollDone } from "~/live/account-rare"
import { rememberOwner } from "~/live/invites"
import type { InviteInfo } from "~/model"

const manage = () => import("~/live/manage")

function joinCodeOf(typed: string): string | null {
  const raw = typed.trim()
  if (isJoinCode(raw)) return raw
  const linked = joinCodeFromLink(raw)
  if (linked) return linked
  try {
    const hash = decodeURIComponent(new URL(raw).hash.slice(1)).trim()
    if (isJoinCode(hash)) return hash
    const path = /\/join\/([^/?#]+)/.exec(new URL(raw).pathname)?.[1]
    const fromPath = path ? decodeURIComponent(path) : ""
    return isJoinCode(fromPath) ? fromPath : null
  } catch {
    return null
  }
}

export async function newChannel(title: string): Promise<string> {
  const person = secrets().person
  const make = async (fresh: boolean) => createChannel(title.trim() || "Untitled channel", await tokenForCreate(fresh), person ? { name: person.name } : null)
  const m = await make(false).catch((err: unknown) => {
    if (isSignInGone(err) && bridge()) return make(true)
    throw err
  })
  void manage().then((x) => x.freshChannel(m.code))
  await linkOf(m)
    .setIcon({ kind: "robot", robot: ROBOT_FACES[Math.floor(Math.random() * ROBOT_FACES.length)] ?? "blue" })
    .catch(() => {
      // The channel exists either way; its owner can pick an icon later.
    })
  return m.code
}

export async function lookUpInvite(typed: string): Promise<InviteInfo> {
  const code = joinCodeOf(typed)
  if (!code) throw new Error(t("live.join.not.invite"))
  if (loadMember(code) || loadPending(code)) return { code, owner: null, state: "member" }
  const info = await inviteInfo(code)
  if (!info) return { code, owner: null, state: "gone" }
  if (info.ownerName) rememberOwner(code, info.ownerName)
  return { code, owner: info.ownerName, state: "ok" }
}

export async function joinChannel(typed: string, name?: string): Promise<string> {
  const code = joinCodeOf(typed)
  if (!code) throw new Error(t("live.join.not.invite"))
  if (loadMember(code) || loadPending(code)) return code
  const person = secrets().person
  if (!person) throw new Error(t("live.join.name.first"))
  await askToJoin(code, name?.trim() || handleFor(person.name))
  return code
}

export async function joinGranted(d: EnrollDone): Promise<void> {
  const name = handleFor(d.person.name)
  let asked = 0
  for (const c of d.channels) {
    if (loadMember(c.code) || loadPending(c.code)) continue
    await askToJoin(c.code, name)
    asked++
  }
  announce(asked ? t("live.join.signed.in.asked", { name: d.person.name, count: asked }) : t("live.join.signed.in", { name: d.person.name }))
}

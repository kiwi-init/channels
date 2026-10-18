import type { CachedRow } from "@kiwi/core/cache-row.ts"
import type { PresenceFields } from "@kiwi/core/client.ts"

import type { CallResult, ChannelCallName, ChannelCalls, ChannelOps, FollowEvent } from "../../../desktop/src/bridge.ts"
import { localOps } from "./channel-local"
import { errorOf, remoteOps } from "./channel-remote"
import { bridge } from "./secrets"
import { makeWatches, type Watches } from "./watch"

export { errorOf }
export type { ChannelOps, FollowEvent }

let picked: ChannelOps | null = null
let watching: Watches | null = null

export function watches(): Watches {
  watching ??= makeWatches(ops())
  return watching
}

export function ops(): ChannelOps {
  if (!picked) {
    const b = bridge()
    picked = b ? remoteOps(b.channels) : localOps()
  }
  return picked
}

type Args<K extends ChannelCallName> = Parameters<ChannelCalls[K]>

export class ChannelLink {
  readonly isOwner: boolean

  constructor(
    readonly code: string,
    readonly roomId: string,
    readonly pk: string,
    ownerPk: string,
    private readonly via: ChannelOps
  ) {
    this.isOwner = pk === ownerPk
  }

  private c<K extends ChannelCallName>(op: K, ...args: Args<K>): Promise<CallResult<K>> {
    return this.via.call(this.code, op, ...args)
  }

  head = () => this.c("head")
  members = () => this.c("members")
  requests = (...a: Args<"requests">) => this.c("requests", ...a)
  checkRequest = (...a: Args<"checkRequest">) => this.c("checkRequest", ...a)
  approve = (...a: Args<"approve">) => this.c("approve", ...a)
  autoApprove = (...a: Args<"autoApprove">) => this.c("autoApprove", ...a)
  deny = (...a: Args<"deny">) => this.c("deny", ...a)
  remove = (...a: Args<"remove">) => this.c("remove", ...a)
  updateScopes = (...a: Args<"updateScopes">) => this.c("updateScopes", ...a)
  updatePersona = (...a: Args<"updatePersona">) => this.c("updatePersona", ...a)
  updateRole = (...a: Args<"updateRole">) => this.c("updateRole", ...a)
  updateNickname = (...a: Args<"updateNickname">) => this.c("updateNickname", ...a)
  reconcilePosting = (...a: Args<"reconcilePosting">) => this.c("reconcilePosting", ...a)
  rotateIfDue = () => this.c("rotateIfDue")
  snapshotIfDue = () => this.c("snapshotIfDue")
  setGithubRepos = (...a: Args<"setGithubRepos">) => this.c("setGithubRepos", ...a)
  drainGithub = () => this.c("drainGithub")
  githubDiff = (...a: Args<"githubDiff">) => this.c("githubDiff", ...a)
  postReviewCheck = (...a: Args<"postReviewCheck">) => this.c("postReviewCheck", ...a)
  commentOnPr = (...a: Args<"commentOnPr">) => this.c("commentOnPr", ...a)
  githubIssue = (...a: Args<"githubIssue">) => this.c("githubIssue", ...a)
  closeIssue = (...a: Args<"closeIssue">) => this.c("closeIssue", ...a)
  snapshotAt = () => this.c("snapshotAt")
  info = () => this.c("info")
  title = () => this.c("title")
  setTitle = (...a: Args<"setTitle">) => this.c("setTitle", ...a)
  rooms = () => this.c("rooms")
  guard = () => this.c("guard")
  setCharter = (...a: Args<"setCharter">) => this.c("setCharter", ...a)
  setHold = (...a: Args<"setHold">) => this.c("setHold", ...a)
  setRepos = (...a: Args<"setRepos">) => this.c("setRepos", ...a)
  icon = () => this.c("icon")
  close = () => this.c("close")
  leave = () => this.c("leave")
  send = (...a: Args<"send">) => this.c("send", ...a)
  image = (...a: Args<"image">) => this.c("image", ...a)
  presence = (p: PresenceFields) => this.via.presence(this.code, p)
  openRows = (rows: CachedRow[]) => this.via.openRows(this.code, rows)
  follow = (since: number, on: (e: FollowEvent) => void) => this.via.follow(this.code, since, on)
}

export function linkOf(m: { code: string; identity: { pk: string }; access: { roomId: string; ownerPk: string } }): ChannelLink {
  return new ChannelLink(m.code, m.access.roomId, m.identity.pk, m.access.ownerPk, ops())
}

import type { CachedKept, CachedRow } from "@kiwi/core/cache-row.ts";
import type { PresenceFields } from "@kiwi/core/client.ts";

import type { CallResult, ChannelCallName, ChannelCalls, ChannelOps, FollowEvent, HistorySearch } from "../../../desktop/src/bridge.ts";
import type { FoldInputs } from "../../../desktop/src/search-types.ts";
import { errorOf, remoteOps } from "./channel-remote.ts";
import { bridge } from "@kiwi/secrets/secrets.ts";
import { makeWatches, type Watches } from "./watch.ts";

export { errorOf };
export type { ChannelOps, FollowEvent };

let picked: ChannelOps | null = null;
let watching: Watches | null = null;

export function watches(): Watches {
  watching ??= makeWatches(ops());
  return watching;
}

function lazyLocalOps(): ChannelOps {
  let real: Promise<ChannelOps> | null = null;
  const local = () => (real ??= import("@kiwi/secrets/channel-local.ts").then((m) => m.localOps()));
  return {
    call: (code, op, ...args) => local().then((o) => o.call(code, op, ...args)),
    create: (name, token, me) => local().then((o) => o.create(name, token, me)),
    requestJoin: (code, name) => local().then((o) => o.requestJoin(code, name)),
    joinStatus: (code) => local().then((o) => o.joinStatus(code)),
    forget: (code) => local().then((o) => o.forget(code)),
    presence: (code, p) => local().then((o) => o.presence(code, p)),
    openRows: (code, rows) => local().then((o) => o.openRows(code, rows)),
    olderRows: (code, before, limit) => local().then((o) => o.olderRows(code, before, limit)),
    indexRows: (code, rows, inputs) => local().then((o) => o.indexRows(code, rows, inputs)),
    searchHistory: (code, search) => local().then((o) => o.searchHistory(code, search)),
    keep: (code, state) => local().then((o) => o.keep(code, state)),
    openKept: (code, sealed) => local().then((o) => o.openKept(code, sealed)),
    nudge: () => {
      if (real) void real.then((o) => o.nudge());
    },
    follow: (code, since, on, opts) => {
      let stop: (() => void) | null = null;
      let gone = false;
      void local().then((o) => {
        if (!gone) stop = o.follow(code, since, on, opts);
      });
      return () => {
        gone = true;
        stop?.();
      };
    },
  };
}

export function ops(): ChannelOps {
  if (!picked) {
    const b = bridge();
    picked = b ? remoteOps(b.channels) : lazyLocalOps();
  }
  return picked;
}

type Args<K extends ChannelCallName> = Parameters<ChannelCalls[K]>;

export class ChannelLink {
  readonly isOwner: boolean;

  constructor(
    readonly code: string,
    readonly roomId: string,
    readonly pk: string,
    ownerPk: string,
    private readonly via: ChannelOps,
  ) {
    this.isOwner = pk === ownerPk;
  }

  private c<K extends ChannelCallName>(op: K, ...args: Args<K>): Promise<CallResult<K>> {
    return this.via.call(this.code, op, ...args);
  }

  head = () => this.c("head");
  members = () => this.c("members");
  requests = (...a: Args<"requests">) => this.c("requests", ...a);
  checkRequest = (...a: Args<"checkRequest">) => this.c("checkRequest", ...a);
  approve = (...a: Args<"approve">) => this.c("approve", ...a);
  autoApprove = (...a: Args<"autoApprove">) => this.c("autoApprove", ...a);
  deny = (...a: Args<"deny">) => this.c("deny", ...a);
  remove = (...a: Args<"remove">) => this.c("remove", ...a);
  cutDevices = (...a: Args<"cutDevices">) => this.c("cutDevices", ...a);
  tendDelegations = (...a: Args<"tendDelegations">) => this.c("tendDelegations", ...a);
  dropDelegates = (...a: Args<"dropDelegates">) => this.c("dropDelegates", ...a);
  updateScopes = (...a: Args<"updateScopes">) => this.c("updateScopes", ...a);
  updatePersona = (...a: Args<"updatePersona">) => this.c("updatePersona", ...a);
  pinPersona = (...a: Args<"pinPersona">) => this.c("pinPersona", ...a);
  updateNickname = (...a: Args<"updateNickname">) => this.c("updateNickname", ...a);
  updatePowers = (...a: Args<"updatePowers">) => this.c("updatePowers", ...a);
  reconcilePosting = (...a: Args<"reconcilePosting">) => this.c("reconcilePosting", ...a);
  rotateIfDue = () => this.c("rotateIfDue");
  snapshotIfDue = () => this.c("snapshotIfDue");
  setGithubRepos = (...a: Args<"setGithubRepos">) => this.c("setGithubRepos", ...a);
  drainGithub = () => this.c("drainGithub");
  syncGithubRules = (...a: Args<"syncGithubRules">) => this.c("syncGithubRules", ...a);
  syncGithubReleases = (...a: Args<"syncGithubReleases">) => this.c("syncGithubReleases", ...a);
  githubDiff = (...a: Args<"githubDiff">) => this.c("githubDiff", ...a);
  postReviewCheck = (...a: Args<"postReviewCheck">) => this.c("postReviewCheck", ...a);
  commentOnPr = (...a: Args<"commentOnPr">) => this.c("commentOnPr", ...a);
  githubIssue = (...a: Args<"githubIssue">) => this.c("githubIssue", ...a);
  closeIssue = (...a: Args<"closeIssue">) => this.c("closeIssue", ...a);
  snapshotAt = () => this.c("snapshotAt");
  snapshot = () => this.c("snapshot");
  info = () => this.c("info");
  title = () => this.c("title");
  setTitle = (...a: Args<"setTitle">) => this.c("setTitle", ...a);
  rooms = () => this.c("rooms");
  guard = () => this.c("guard");
  setCharter = (...a: Args<"setCharter">) => this.c("setCharter", ...a);
  setHold = (...a: Args<"setHold">) => this.c("setHold", ...a);
  setRooms = (...a: Args<"setRooms">) => this.c("setRooms", ...a);
  makeRoom = (...a: Args<"makeRoom">) => this.c("makeRoom", ...a);
  makeDm = (...a: Args<"makeDm">) => this.c("makeDm", ...a);
  syncMarks = (...a: Args<"syncMarks">) => this.c("syncMarks", ...a);
  changeRoom = (...a: Args<"changeRoom">) => this.c("changeRoom", ...a);
  pruneRooms = (...a: Args<"pruneRooms">) => this.c("pruneRooms", ...a);
  setRepos = (...a: Args<"setRepos">) => this.c("setRepos", ...a);
  icon = () => this.c("icon");
  setIcon = (...a: Args<"setIcon">) => this.c("setIcon", ...a);
  close = () => this.c("close");
  leave = () => this.c("leave");
  send = (...a: Args<"send">) => this.c("send", ...a);
  image = (...a: Args<"image">) => this.c("image", ...a);
  history = (...a: Args<"history">) => this.c("history", ...a);
  presence = (p: PresenceFields) => this.via.presence(this.code, p);
  openRows = (rows: CachedRow[]) => this.via.openRows(this.code, rows);
  olderRows = (before: number, limit: number) => this.via.olderRows(this.code, before, limit);
  indexRows = (rows: CachedRow[], inputs: FoldInputs) => this.via.indexRows(this.code, rows, inputs);
  searchHistory = (search: HistorySearch) => this.via.searchHistory(this.code, search);
  keep = (state: object) => this.via.keep(this.code, state);
  openKept = (sealed: CachedKept) => this.via.openKept(this.code, sealed);
  follow = (since: number, on: (e: FollowEvent) => void) => this.via.follow(this.code, since, on);
}

export function linkOf(m: { code: string; identity: { pk: string }; access: { roomId: string; ownerPk: string } }): ChannelLink {
  return new ChannelLink(m.code, m.access.roomId, m.identity.pk, m.access.ownerPk, ops());
}

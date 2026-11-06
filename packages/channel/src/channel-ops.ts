import type { CachedKept, CachedRow } from "@kiwi/core/cache-row.ts";
import type { PresenceFields } from "@kiwi/core/client.ts";
import { RelayError } from "@kiwi/core/client/relay-errors.ts";
import type { Outgoing } from "@kiwi/core/ship-gate.ts";

import type { CallResult, ChannelCallName, ChannelCalls, ChannelOps, DocEvent, FollowEvent, HistoryAround, HistorySearch } from "../../../desktop/src/bridge.ts";
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts";
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
    indexRows: (code, rows, inputs, from) => local().then((o) => o.indexRows(code, rows, inputs, from)),
    searchHistory: (code, search) => local().then((o) => o.searchHistory(code, search)),
    historyAround: (code, around) => local().then((o) => o.historyAround(code, around)),
    keep: (code, state) => local().then((o) => o.keep(code, state)),
    openKept: (code, sealed) => local().then((o) => o.openKept(code, sealed)),
    nudge: () => {
      if (real) void real.then((o) => o.nudge());
    },
    doc: (code, thread, th, on) => {
      const { pipe, attach } = heldPipe();
      void local().then(
        (o) => attach(o.doc(code, thread, th, on)),
        (e: unknown) => on({ _tag: "Failed", error: { kind: "other", message: e instanceof Error ? e.message : String(e) } }),
      );
      return pipe;
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
  beforeSend: ((body: string, opts: Omit<Outgoing, "from" | "body">) => Promise<string[]>) | null = null;

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
  goneDevices = (...a: Args<"goneDevices">) => this.c("goneDevices", ...a);
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
  docList = () => this.c("docList");
  pruneDocs = (...a: Args<"pruneDocs">) => this.c("pruneDocs", ...a);
  compactDoc = (...a: Args<"compactDoc">) => this.c("compactDoc", ...a);
  docVersions = (...a: Args<"docVersions">) => this.c("docVersions", ...a);
  docVersionState = (...a: Args<"docVersionState">) => this.c("docVersionState", ...a);
  setGithubRepos = (...a: Args<"setGithubRepos">) => this.c("setGithubRepos", ...a);
  drainGithub = () => this.c("drainGithub");
  syncGithubRules = (...a: Args<"syncGithubRules">) => this.c("syncGithubRules", ...a);
  syncGithubReleases = (...a: Args<"syncGithubReleases">) => this.c("syncGithubReleases", ...a);
  syncGithub = (...a: Args<"syncGithub">) => this.c("syncGithub", ...a);
  githubStatus = () => this.c("githubStatus");
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
  leaveRoom = (...a: Args<"leaveRoom">) => this.c("leaveRoom", ...a);
  sentRooms = (...a: Args<"sentRooms">) => this.c("sentRooms", ...a);
  setRepos = (...a: Args<"setRepos">) => this.c("setRepos", ...a);
  icon = () => this.c("icon");
  setIcon = (...a: Args<"setIcon">) => this.c("setIcon", ...a);
  close = () => this.c("close");
  leave = () => this.c("leave");
  send = async (...[body, opts = {}]: Args<"send">) => {
    const once = async () => {
      const tickets = (await this.beforeSend?.(body, opts)) ?? [];
      return this.c("send", body, tickets.length ? { ...opts, tickets } : opts);
    };
    try {
      return await once();
    } catch (err) {
      if (!(err instanceof RelayError && err.tag === "Fenced")) throw err;
      return once();
    }
  };
  image = (...a: Args<"image">) => import("./image-bytes.ts").then((m) => m.heldImage(a[0]) ?? this.c("image", ...a));
  putImage = (...a: Args<"putImage">) => this.c("putImage", ...a);
  putFileData = (...a: Args<"putFileData">) => this.c("putFileData", ...a);
  fileData = (...a: Args<"fileData">) => this.c("fileData", ...a);
  history = (...a: Args<"history">) => this.c("history", ...a);
  presence = (p: PresenceFields) => this.via.presence(this.code, p);
  openRows = (rows: CachedRow[]) => this.via.openRows(this.code, rows);
  olderRows = (before: number, limit: number) => this.via.olderRows(this.code, before, limit);
  indexRows = (rows: CachedRow[], inputs: FoldInputs, from: number) => this.via.indexRows(this.code, rows, inputs, from);
  searchHistory = (search: HistorySearch) => this.via.searchHistory(this.code, search);
  historyAround = (around: HistoryAround) => this.via.historyAround(this.code, around);
  keep = (state: object) => this.via.keep(this.code, state);
  openKept = (sealed: CachedKept) => this.via.openKept(this.code, sealed);
  follow = (since: number, on: (e: FollowEvent) => void) => this.via.follow(this.code, since, on);
  doc = (thread: string, th: string | null, on: (e: DocEvent) => void) => this.via.doc(this.code, thread, th, on);
}

export function linkOf(m: { code: string; identity: { pk: string }; access: { roomId: string; ownerPk: string } }): ChannelLink {
  return new ChannelLink(m.code, m.access.roomId, m.identity.pk, m.access.ownerPk, ops());
}

// window.kiwi: the main-process bridge the renderer (web/dist) talks to. Shared by
// main.ts and preload.ts; renderer-neutral on purpose (no electron/node imports),
// so web/ can type against it without touching this process.

import type { CachedRow } from "../../src/cache-row.ts";
import type { Channel, PresenceFields } from "../../src/client.ts";
import type { Message, Presence, ReadMark } from "../../src/protocol.ts";
import type { Wire } from "./wire.ts";

/** The person's own key. Same JSON shape as Identity in src/identity.ts. */
export interface PersonView {
  name: string;
  pk: string;
  sk: string;
  xpk: string;
  xsk: string;
}

export type PublicPerson = Pick<PersonView, "name" | "pk" | "xpk">;

/** One channel identity of the person's (owner keys included). */
export interface ChannelIdentityView {
  /** What the person calls it (channel name). */
  label: string;
  pk: string;
  sk: string;
  xpk?: string;
  xsk?: string;
  roomId?: string;
  /** The renderer's record for this channel: its join code, channel access (keys), when, and (while waiting) the join request. Opaque here. */
  code?: string;
  /** The member key's name in the channel (label is what the person calls the channel). */
  idName?: string;
  /** The channel's sealed name, once known. */
  name?: string;
  access?: unknown;
  at?: number;
  requestId?: string;
}

export interface PublicAccess {
  roomId: string;
  ownerPk: string;
  ownerXpk: string;
  epoch: number;
  signedKeys?: boolean;
  signedTitle?: boolean;
}

export interface ChannelView {
  label: string;
  pk: string;
  xpk?: string;
  roomId?: string;
  code?: string;
  idName?: string;
  name?: string;
  access?: PublicAccess;
  at?: number;
  requestId?: string;
}

export const CHANNEL_CALLS = [
  "head",
  "members",
  "requests",
  "checkRequest",
  "approve",
  "autoApprove",
  "deny",
  "remove",
  "updateScopes",
  "updateRole",
  "reconcilePosting",
  "rotateIfDue",
  "info",
  "title",
  "setTitle",
  "mode",
  "setMode",
  "rooms",
  "guard",
  "setCharter",
  "setHold",
  "icon",
  "close",
  "leave",
  "send",
] as const;

export type ChannelCallName = (typeof CHANNEL_CALLS)[number];
export type ChannelCalls = Pick<Channel, ChannelCallName>;
export type CallResult<K extends ChannelCallName> = Awaited<ReturnType<ChannelCalls[K]>>;

export type JoinCheck = { status: "pending"; code: string | null } | { status: "denied" } | { status: "in"; channel: ChannelView };

export type FollowEvent =
  | { _tag: "Open" }
  | { _tag: "Message"; message: Message; row: CachedRow | null }
  | { _tag: "Presence"; presence: Presence & { sigOk: boolean } }
  | { _tag: "Read"; reads: ReadMark[]; snapshot: boolean }
  | { _tag: "Info" }
  | { _tag: "Roster" }
  | { _tag: "Request" }
  | { _tag: "Status"; line: string }
  | { _tag: "Failed"; error: WireError };

export interface ChannelOps {
  call<K extends ChannelCallName>(code: string, op: K, ...args: Parameters<ChannelCalls[K]>): Promise<CallResult<K>>;
  create(name: string, token: string | null, me: { name: string } | null): Promise<ChannelView>;
  requestJoin(code: string, name: string, role?: string): Promise<ChannelView>;
  joinStatus(code: string): Promise<JoinCheck>;
  forget(code: string): Promise<void>;
  presence(code: string, p: PresenceFields): Promise<void>;
  openRows(code: string, rows: CachedRow[]): Promise<(Message | null)[]>;
  follow(code: string, since: number, on: (e: FollowEvent) => void): () => void;
}

export type WireError =
  | { kind: "gone"; why: "removed" | "closed" }
  | { kind: "relay"; status: number; message: string; tag?: string }
  | { kind: "unreachable"; message: string }
  | { kind: "other"; message: string; tag?: string };

export type KeysAsk =
  | { op: "call"; code: string; name: ChannelCallName; args: Wire }
  | { op: "create"; name: string; token: string | null; me: { name: string } | null }
  | { op: "requestJoin"; code: string; name: string; role?: string }
  | { op: "joinStatus"; code: string }
  | { op: "forget"; code: string }
  | { op: "presence"; code: string; p: Wire }
  | { op: "openRows"; code: string; rows: Wire }
  | { op: "follow"; code: string; since: number }
  | { op: "unfollow"; sub: number };

export type KeysRequest = KeysAsk & { id: number };
export type KeysReply = { id: number; ok: true; value: Wire } | { id: number; ok: false; error: WireError };
export interface KeysPush {
  sub: number;
  event: Wire;
}

export interface KeysPort {
  request(ask: KeysAsk): Promise<KeysReply>;
  onPush(cb: (p: KeysPush) => void): () => void;
  onRestart(cb: () => void): () => void;
}

/** A computer paired with this app (or adopted: this machine). */
export interface ComputerView {
  label: string;
  os: string;
  machinePk: string;
  machineXpk: string;
  /** The person key that certified it. */
  personPk: string;
  at: number;
  /** This machine (adopted daemon), rather than a remotely paired one. */
  own?: boolean;
}

/** A join request waiting on the person; the renderer round-trips these. */
export interface PendingItem {
  id: string;
  at: number;
  title: string;
  body: unknown;
}

/** Everything the renderer needs at load: one synchronous snapshot (see main). */
export interface StoreSnapshot {
  relayUrl: string;
  person: PublicPerson | null;
  channels: ChannelView[];
  computers: ComputerView[];
  pending: PendingItem[];
}

/** A computer asking to pair, for the person to confirm. */
export interface PairAskView {
  label: string;
  os: string;
  machinePk: string;
  at: number;
}

/** "kiwi daemon" as the app sees it. */
export interface DaemonStatus {
  running: boolean;
  version?: string;
  machinePk?: string;
  pairedPerson?: { pk: string; name: string } | null;
}

export type SignInResult = { token: string } | { dev: true };

export interface KiwiBridge {
  /** The relay URL injected at load (query param, else the default). */
  readonly relayUrl: string;
  /** Synchronous snapshot; main decrypts once at startup (safeStorage). */
  getSnapshot(): StoreSnapshot;
  onStore(cb: (s: StoreSnapshot) => void): () => void;
  setRelayUrl(url: string): Promise<string>;
  createPerson(name: string): Promise<PublicPerson>;
  saveChannels(channels: ChannelView[]): Promise<void>;
  migrateChannels(entries: ChannelIdentityView[]): Promise<number>;
  readonly channels: KeysPort;
  saveComputers(computers: ComputerView[]): Promise<void>;
  setPending(pending: PendingItem[]): Promise<void>;
  /** WorkOS device authorization (system browser, polled in main), or { dev } for a dev relay. */
  signIn(): Promise<SignInResult>;
  /** A dev relay's sign-in: whoever they say (never a real WorkOS id). */
  devSignIn(name: string): Promise<{ token: string }>;
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Pairing: show the code, poll slot a, answer into slot b. */
  pairBegin(): Promise<{ code: string }>;
  pairPoll(): Promise<PairAskView | null>;
  pairAnswer(accept: boolean): Promise<{ machinePk: string } | null>;
  pairCancel(): Promise<void>;
  daemonStatus(): Promise<DaemonStatus>;
  /** Certify this machine's daemon key with the person key and hand the cert back. */
  daemonAdopt(): Promise<ComputerView>;
  /** Put the bundled kiwi binary in ~/.kiwi/bin and on the PATH (the app also does this on every start). */
  installCli(): Promise<{ path: string }>;
  /** A newer proper release: being downloaded, ready to restart into, or only available (a .deb). */
  getUpdate(): Promise<UpdateView | null>;
  onUpdate(cb: (u: UpdateView) => void): () => void;
  /** Restart into the downloaded update. */
  installUpdate(): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** The kiwi://join/<code> link waiting to be opened, if any; taking it clears it. */
  getDeepLink(): Promise<string | null>;
  /** A link came in while the app runs (it waits for getDeepLink too, so it's opened once). */
  onDeepLink(cb: (url: string) => void): () => void;
}

export interface UpdateView {
  version: string;
  state: "downloading" | "ready" | "available";
  /** The release's page. */
  url: string;
}

declare global {
  interface Window {
    kiwi: KiwiBridge;
  }
}

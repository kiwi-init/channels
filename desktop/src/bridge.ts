// window.kiwi: the main-process bridge the renderer (ui/dist) talks to. Shared by
// main-eb.ts and preload-eb.ts; renderer-neutral on purpose (no node imports),
// so ui/ can type against it without touching this process.

import type { ComputerSettings } from "@kiwi/core/computer-settings.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import type { HarnessRow, HookHarness, HookRow, KnownHarness } from "@kiwi/core/harnesses.ts";
import type { LaunchChoices } from "@kiwi/core/launch-options.ts";
import type { WakeSeat } from "@kiwi/core/wake.ts";
import type { Personality } from "@kiwi/core/personality.ts";
import type { CachedKept, CachedRow, Unread } from "@kiwi/core/cache-row.ts";
import type { Channel, OpenKind, PresenceFields } from "@kiwi/core/client.ts";
import type { MemberPicture, Message, Presence, ReadMark } from "@kiwi/core/protocol.ts";
import type { LaunchedView, PlacedSeat, ShowResult, TerminalId, TerminalsStatus } from "@kiwi/core/terminals.ts";
import type { TextStep } from "./text-size.ts";
import type { Wire } from "./wire.ts";

export type DroppedFile = { name: string; type: string; data: string } | { name: string; refused: string };
export type PastedImage = { type: string; data: string };

export type DoctorFinding = { ok: true; what: string } | { ok: false; what: string; how: string };

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
  imported?: boolean;
  creating?: true;
  relay?: string;
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
  relay?: string;
}

export const CHANNEL_CALLS = [
  "head",
  "members",
  "requests",
  "checkRequest",
  "approve",
  "pinPersona",
  "autoApprove",
  "deny",
  "remove",
  "cutDevices",
  "tendDelegations",
  "dropDelegates",
  "updateScopes",
  "updatePersona",
  "updateNickname",
  "updatePowers",
  "reconcilePosting",
  "rotateIfDue",
  "snapshotIfDue",
  "setGithubRepos",
  "drainGithub",
  "syncGithubRules",
  "syncGithubReleases",
  "githubDiff",
  "postReviewCheck",
  "commentOnPr",
  "githubIssue",
  "closeIssue",
  "snapshotAt",
  "snapshot",
  "info",
  "title",
  "setTitle",
  "rooms",
  "guard",
  "setCharter",
  "setHold",
  "setRooms",
  "setRepos",
  "makeRoom",
  "changeRoom",
  "icon",
  "setIcon",
  "close",
  "leave",
  "send",
  "image",
  "history",
] as const;

export type ChannelCallName = (typeof CHANNEL_CALLS)[number];
export type ChannelCalls = Pick<Channel, ChannelCallName>;
export type CallResult<K extends ChannelCallName> = Awaited<ReturnType<ChannelCalls[K]>>;

export type JoinCheck = { status: "pending"; code: string | null } | { status: "denied" } | { status: "in"; channel: ChannelView };

export type FollowEvent =
  | { _tag: "Open"; kind?: OpenKind }
  | { _tag: "Message"; message: Message; row: CachedRow | null }
  | { _tag: "Unread"; seq: number; row: CachedRow | null }
  | { _tag: "Head"; seq: number }
  | { _tag: "Presence"; presence: Presence & { sigOk: boolean } }
  | { _tag: "Read"; reads: ReadMark[]; snapshot: boolean }
  | { _tag: "Info" }
  | { _tag: "Roster" }
  | { _tag: "Request" }
  | { _tag: "Status"; line: string }
  | { _tag: "Down" }
  | { _tag: "Failed"; error: WireError };

export interface ChannelOps {
  call<K extends ChannelCallName>(code: string, op: K, ...args: Parameters<ChannelCalls[K]>): Promise<CallResult<K>>;
  create(name: string, token: string | null, me: { name: string } | null): Promise<ChannelView>;
  requestJoin(code: string, name: string): Promise<ChannelView>;
  joinStatus(code: string): Promise<JoinCheck>;
  forget(code: string): Promise<void>;
  presence(code: string, p: PresenceFields): Promise<void>;
  openRows(code: string, rows: CachedRow[]): Promise<(Message | Unread | null)[]>;
  keep(code: string, state: object): Promise<CachedKept | null>;
  openKept(code: string, sealed: CachedKept): Promise<unknown>;
  follow(code: string, since: number, on: (e: FollowEvent) => void, opts?: FollowOptions): () => void;
  nudge(): void;
}

export interface FollowOptions {
  watch?: boolean;
}

export type WireError =
  | { kind: "gone"; why: "removed" | "closed" }
  | { kind: "relay"; status: number; message: string; tag?: string }
  | { kind: "unreachable"; message: string }
  | { kind: "other"; message: string; tag?: string };

export type KeysAsk =
  | { op: "call"; code: string; name: ChannelCallName; args: Wire }
  | { op: "create"; name: string; token: string | null; me: { name: string } | null }
  | { op: "requestJoin"; code: string; name: string }
  | { op: "joinStatus"; code: string }
  | { op: "forget"; code: string }
  | { op: "presence"; code: string; p: Wire }
  | { op: "openRows"; code: string; rows: Wire }
  | { op: "keep"; code: string; state: Wire }
  | { op: "openKept"; code: string; sealed: Wire }
  | { op: "follow"; code: string; since: number; watch?: boolean }
  | { op: "unfollow"; sub: number }
  | { op: "nudge" };

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
  /** This machine (adopted daemon), rather than another of the person's computers. */
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
  phones: PhoneView[];
  pending: PendingItem[];
  personalities: Personality[];
}

export interface PhoneView {
  label: string;
  at: number;
  channels?: string[];
}

export interface EnrollAskView {
  id: string;
  label: string;
  os: string;
  as: "desktop" | "phone" | "computer";
  at: number;
  stage: "new" | "waiting" | "digits" | "elsewhere";
  fingerprint: string | null;
}

export interface DeviceView {
  id: string;
  label: string;
  os: string;
  as: "desktop" | "phone" | "computer";
  approve: boolean;
  until: number;
  thisOne: boolean;
}

interface DeviceRevokeView {
  device: string;
  label: string;
  as: "desktop" | "phone" | "computer";
  by: string;
  at: number;
  older: boolean;
}

export interface DeviceNewsView {
  links: DeviceLink[];
  revokes: DeviceRevokeView[];
  removed: { wiped: boolean; by: string } | null;
}

export type EnrollConfirmView = { ok: true; label: string } | { ok: false; left: number };

export interface EnrollPersonView {
  name: string;
  fingerprint: string;
}

export type EnrollKeptView = { stage: "done"; person: PublicPerson; channels: { label: string; code: string }[] };

export type EnrollStatusView = { stage: "asking" } | { stage: "digits"; digits: string } | { stage: "check"; person: EnrollPersonView } | EnrollKeptView | { stage: "gone" };

/** "kiwi daemon" as the app sees it. */
export interface DaemonStatus {
  running: boolean;
  version?: string;
  machinePk?: string;
  pairedPerson?: { pk: string; name: string } | null;
}

export type SignInResult = { token: string } | { dev: true };

export interface GithubRepoView {
  fullName: string;
  private: boolean;
  pushedAt: number;
}

export interface GithubStatus {
  available: boolean;
  /** The relay takes GitHub sign-in, so this link is how the person signs in. */
  signIn?: boolean;
  account: { login: string; id: number; at: number } | null;
  moveRefused?: string;
}

export interface MachineView {
  machinePk: string;
  label: string;
  os: string;
  own: boolean;
  online: boolean | null;
}

export type TermOpenView = { ok: true; term: string; pane: string; window: string; cols: number; rows: number; seed: string; dead: boolean } | { ok: false; detail: string };

export interface TermTabView {
  pane: string;
  label: string;
}

export type TermEvent = { term: string; out: string } | { term: string; ended: true };

export type FromMachine<T> = { ok: true; value: T } | { ok: false; detail: string };

export interface LaunchAgentRequest extends LaunchChoices {
  machinePk?: string;
  launch: string;
  harness: KnownHarness;
  folder: string;
  code: string;
  relay: string;
  nick?: string;
  persona?: string;
}

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
  /** Whether this relay has a GitHub App, and who this Mac is linked to. The token leaves main only to connect repos on a relay that has the App, through the keys process to that relay, which checks push access with it and keeps nothing. */
  githubStatus(): Promise<GithubStatus>;
  /** GitHub's device flow: onGithubCode gets the code to type, then this resolves once it's typed and approved. */
  githubLink(): Promise<GithubStatus>;
  githubUnlink(): Promise<GithubStatus>;
  /** The repos the linked account can reach through the App, most recently pushed first. The token stays in main. */
  githubRepos(): Promise<GithubRepoView[]>;
  /** The linked account's GitHub avatar, fetched by main (no page loads from GitHub), or null when nothing is linked. */
  githubPicture(): Promise<MemberPicture | null>;
  onGithubCode(cb: (c: { code: string; url: string }) => void): () => void;
  pairBegin(): Promise<never>;
  pairPoll(): Promise<never>;
  pairAnswer(accept: boolean): Promise<never>;
  pairCancel(): Promise<never>;
  linkBegin(): Promise<never>;
  linkPoll(): Promise<never>;
  linkAnswer(accept: boolean): Promise<never>;
  linkCancel(): Promise<never>;
  forgetPhone(at: number): Promise<void>;
  enrollPoll(): Promise<EnrollAskView | null>;
  enrollAnswer(id: string): Promise<void>;
  enrollConfirm(id: string, digits: string): Promise<EnrollConfirmView>;
  enrollDeny(id: string): Promise<void>;
  enrollBegin(): Promise<void>;
  enrollStatus(): Promise<EnrollStatusView | null>;
  enrollKeep(): Promise<EnrollKeptView>;
  enrollCancel(): Promise<void>;
  devices(): Promise<DeviceView[] | null>;
  forgetDevice(id: string): Promise<void>;
  renewDevice(id: string): Promise<void>;
  deviceNews(): Promise<DeviceNewsView | null>;
  daemonStatus(): Promise<DaemonStatus>;
  doctor(): Promise<DoctorFinding[] | null>;
  /** Certify this machine's daemon key with the person key and hand the cert back. */
  daemonAdopt(): Promise<ComputerView>;
  /** Put the bundled kiwi binary in ~/.kiwi/bin and on the PATH (the app also does this on every start). */
  installCli(): Promise<{ path: string }>;
  /** A newer proper release: being downloaded, ready to restart into, or only available. */
  keysAtRest(): Promise<KeysAtRest>;
  wallpaperTints(dark: boolean): Promise<string[]>;
  wallpaperBackdrop(dark: boolean): Promise<string | null>;
  windowControl(action: "minimize" | "maximize" | "close"): Promise<void>;
  getUpdate(): Promise<UpdateView | null>;
  onUpdate(cb: (u: UpdateView) => void): () => void;
  /** Restart into the downloaded update. */
  installUpdate(): Promise<void>;
  checkUpdate(): Promise<UpdateCheckView>;
  notify(title: string, body: string, link?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  saveFile(name: string, text: string): Promise<string>;
  takeDroppedFiles(): Promise<DroppedFile[]>;
  takePastedImage(): Promise<PastedImage | null>;
  compressImage(data: string, limit: number): Promise<PastedImage>;
  setBadge(count: number): Promise<void>;
  setAppearance(appearance: "system" | "light" | "dark"): Promise<void>;
  /** The UI booted. Channels boots its UI from a signed UI channel and rolls back one that doesn't say so in time. */
  uiReady(): Promise<void>;
  /** An uncaught error while the UI boots, or one that brought the whole UI down. */
  uiError(message: string): Promise<void>;
  /** A new UI from the channel, downloaded and waiting for the person to accept it (it also starts on the next launch). */
  getUiUpdate(): Promise<UiUpdateView | null>;
  onUiUpdate(cb: (u: UiUpdateView | null) => void): () => void;
  /** Swap to the waiting UI now: the page reloads into it. */
  applyUi(): Promise<void>;
  /** The kiwi://join/<code> link waiting to be opened, if any; taking it clears it. */
  getDeepLink(): Promise<string | null>;
  /** A link came in while the app runs (it waits for getDeepLink too, so it's opened once). */
  onDeepLink(cb: (url: string) => void): () => void;
  onTextStep(cb: (step: TextStep) => void): () => void;
  onFrost(cb: (on: boolean) => void): () => void;
  getAccentColor(): Promise<string | null>;
  onAccent(cb: (color: string | null) => void): () => void;
  setPersonalities(list: Personality[]): Promise<void>;
  seatPlaces(): Promise<PlacedSeat[]>;
  showSeat(seat: PlacedSeat): Promise<ShowResult>;
  /** Watch and type in a hosted agent's tmux pane: the daemon sizes it, then sends the screen and what follows as onTerm events. */
  termOpen(pane: string, cols: number, rows: number): Promise<TermOpenView>;
  termMine(roomId: string, want: string | null, cols: number, rows: number): Promise<TermOpenView>;
  termTabs(): Promise<TermTabView[]>;
  termTabClose(pane: string): Promise<TermTabView[]>;
  termKeys(term: string, keys: string): Promise<void>;
  termSize(term: string, cols: number, rows: number): Promise<void>;
  termClose(term: string): Promise<void>;
  onTerm(cb: (e: TermEvent) => void): () => void;
  terminals(): Promise<TerminalsStatus | null>;
  terminalHelpers(id: TerminalId, to: "on" | "off"): Promise<TerminalsStatus | null>;
  terminalPrefer(id: TerminalId): Promise<TerminalsStatus | null>;
  setLaunches(to: "on" | "off"): Promise<TerminalsStatus | null>;
  setRemoteBypass(to: "on" | "off"): Promise<TerminalsStatus | null>;
  contextLine(): Promise<"on" | "off" | null>;
  setContextLine(to: "on" | "off"): Promise<"on" | "off" | null>;
  hooks(): Promise<HookRow[]>;
  setHooks(harness: HookHarness, to: "on" | "off"): Promise<HookRow[]>;
  wakeSeats(): Promise<WakeSeat[]>;
  setWake(room: string, agent: string, to: "on" | "off"): Promise<WakeSeat[]>;
  harnesses(): Promise<HarnessRow[]>;
  seatFolders(roomId: string): Promise<string[]>;
  chooseFolder(): Promise<string | null>;
  launchAgent(req: LaunchAgentRequest): Promise<LaunchedView>;
  machines(): Promise<MachineView[]>;
  harnessesOn(machinePk: string): Promise<FromMachine<HarnessRow[]>>;
  foldersOn(machinePk: string, roomId: string): Promise<FromMachine<string[]>>;
  settingsOn(machinePk: string): Promise<FromMachine<ComputerSettings>>;
  launchRoots(): Promise<string[]>;
  setLaunchRoot(dir: string, to: "add" | "remove"): Promise<string[]>;
}

export interface KeysAtRest {
  sealed: boolean;
  why: string | null;
}

export interface UiUpdateView {
  version: string;
}

export interface UpdateView {
  version: string;
  state: "downloading" | "ready" | "available";
  /** The release's page. */
  url: string;
  blocked?: true;
}

export type UpdateCheckView = UpdateView | { state: "current"; version: string } | { state: "failed" };

declare global {
  interface Window {
    kiwi: KiwiBridge;
  }
}

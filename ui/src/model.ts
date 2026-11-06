import type { Words } from "./words.ts"
import type { TextFont } from "@kiwi/app/theme.ts"
import type { GithubHealth } from "@kiwi/core/github-health.ts"
import type { HookHarness, HookState } from "@kiwi/core/harnesses.ts"
import type { Personality } from "@kiwi/core/personality.ts"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import type { DocBlockRef, GithubNote, Step, StepReply } from "@kiwi/core/protocol.ts"
import type { DocEvent } from "../../desktop/src/bridge.ts"

export type Harness = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "grok" | "kimi" | "mimo" | "pi" | "grok-bot" | "zcode" | "agy" | "other"

type Presence = "online" | "away" | "offline"

export type TaskStatus = "todo" | "doing" | "review" | "landing" | "done" | "waiting"

type Stage = "open" | "building" | "proving" | "red" | "yours" | "done" | "dropped"

type Kind = "human" | "agent"

export type Color = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "violet" | "pink" | "brown"

export interface Activity {
  state: "working" | "waiting" | "idle"
  tool?: string
  since?: number
  context?: { used: number; window?: number }
}

export interface Load {
  level: "free" | "busy" | "overloaded"
  doing: number[]
  queued: number[]
  waiting: number[]
}

export interface KeptAgent {
  code: string
  pk: string
  from: string
}

export interface LaunchedAgent extends KeptAgent {
  name: string
}

export interface Person {
  name: string
  kind: Kind
  display?: string
  role?: string
  color?: Color
  picture?: string
  owner: boolean
  you: boolean
  seatOf?: string
  face?: string
  presence: Presence
  activity?: Activity
  reach?: "listening" | "running" | "wakes"
  harness?: Harness
  runs?: string
  model?: string
  machine?: string
  specs?: string
  tools?: string[]
  repo?: string
  branch?: string
  outside?: boolean
  persona?: string
  sponsor?: string
  yours?: boolean
  about?: string
  load?: Load
  red?: true
  doneAt?: number
  readOnly?: boolean
  wakes?: boolean
  addsAgents?: boolean
  answersDecisions?: boolean
  managesAgents?: boolean
  lastSeen: number
  joined: number
  messages: number
  left?: boolean
}

export interface Check {
  name: string
  state: "pass" | "fail" | "running" | "waiting" | "skipped"
  word: string
  required?: boolean
  url?: string
}

export interface PullRequest {
  repo: string
  number: number
  title: string
  url: string
  state: "open" | "draft" | "merged" | "closed"
  checks: "pass" | "fail" | "running" | "none"
  ticks?: { passed: number; running: number; failed: readonly string[] }
  list?: readonly Check[]
  mergedAt?: number
  additions?: number
  deletions?: number
  files?: number
  branch?: string
  by?: string
  at?: number
  task?: number
  release?: string
}

export interface Issue {
  repo: string
  number: number
  title: string
  url: string
  state: "open" | "closed"
  reason?: string
  by?: string
  at: number
  task?: number
}

interface TaskNote {
  by: string
  at: number
  text: Words
}

export interface ReviewRound {
  n: number
  by: string
  judge?: string
  at: number
  result: "open" | "approved" | "rejected" | "withdrawn"
  summary?: Words
}

export type TaskMove =
  | "created"
  | "took"
  | "assigned"
  | "unassigned"
  | "started"
  | "blocked"
  | "reopened"
  | "review"
  | "approved"
  | "rejected"
  | "done"
  | "cancelled"
  | "reviewer"
  | "renamed"
  | "proof"
  | "checkpoint"
  | "note"
  | "mention"

export interface TaskEvent {
  seq: number
  by: string
  at: number
  what: TaskMove
  to?: string
  round?: number
  note?: Words
  where?: Where
  root?: number
}

export interface Task {
  id: number
  title: Words
  detail?: Words
  status: TaskStatus
  owner?: string
  reviewer?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  pr?: PullRequest
  stage?: Stage
  release?: string
  notes: TaskNote[]
  rounds: ReviewRound[]
  history: TaskEvent[]
  archived: boolean
  cancelled?: boolean
  lands?: { then: string; by?: string; waits?: string; bypassed?: string[]; ready?: true }
  closedWith?: Words
  youReview?: "verdict" | "send-back"
  suggested?: { name: string; why: Words }
  leftBy?: string
}

type SpecStage = "draft" | "queued" | "working" | "delivered" | "accepted" | "dropped"

interface SpecMark {
  by: string
  at: number
}

export interface Spec {
  ask: number
  title: Words
  words: Words
  by: string
  at: number
  text: Words
  v: number
  edited: SpecMark
  edits: number
  editors: string[]
  stage: SpecStage
  ready?: true
  approved?: SpecMark & { v: number; text: Words }
  changed?: true
  result?: SpecMark & { verdict: "accepted" | "dropped"; note?: Words; auto?: true }
  backs: (SpecMark & { note: Words })[]
  comments: number[]
  tasks: number[]
  planner?: string
  queue?: number
  canJudge?: true
}

export interface SpecAsk {
  kind: "spec"
  id: string
  at: number
  ask: number
  why: "approve" | "changed" | "result"
}

type TaskGroupHead =
  | { kind: "ask"; id: number; by: string; words: string; goal?: string; mayName: boolean }
  | { kind: "unfiled" }
  | { kind: "next"; name?: string }
  | { kind: "release"; tag: string; at: number }
  | { kind: "cancelled" }

export interface TaskGroup {
  key: string
  head: TaskGroupHead
  tasks: number[]
}

export interface DocVersion {
  upto: number
  ts: number
  bytes: number
}

export type Where = { kind: "room"; room: string } | { kind: "dm"; with: string } | { kind: "theirs"; between: readonly [string, string] } | { kind: "task"; task: number }

export interface Room {
  id: string
  name: string
  unread: number
  mentions: number
  seen?: number
  members?: string[]
  muted?: true
}

export interface OlderHit {
  seq: number
  from: string
  text: string
  at: number
  where: Where
}

export interface OlderSearch {
  state: "ready" | "indexing" | "none"
  hits: OlderHit[]
  more: { since: number | null; upTo: number } | null
}

export interface Direct {
  with: string
  unread: number
  last: number
  seen?: number
  membersOnly?: true
  doc?: string
}

export interface TheirDirect {
  between: readonly [string, string]
  last: number
}

export interface DocImage {
  name: string
  mime: string
  ref: { id: string; key: string; size: number }
}

export interface DocFile {
  name: string
  mime: string
  size: number
  pieces: { id: string; key: string; size: number }[]
}

export interface BlockFiles {
  imgs: readonly DocImage[]
  files: readonly DocFile[]
}

export interface Upload {
  name: string
  mime: string
  data: string
}

export interface Image {
  url: string
  width: number
  height: number
  alt: string
  id?: string
}

export interface ImageSpot {
  spot: string
  alt: string
  state: "waiting" | "failed" | "gone"
}

export interface Reaction {
  emoji: string
  by: string[]
}

export interface Said {
  text: string
  tone: "quiet" | "ask" | "alert" | "decide"
}

export interface ThreadItem {
  root: number
  following: boolean
  replies: number
  unread: number
  mentions: number
  last: number
  lastSeq: number
  people: string[]
}

export interface Message {
  seq: number
  from: string
  at: number
  text: Words
  block?: string
  membersOnly?: true
  where: Where
  to?: readonly string[]
  said?: Said
  replyTo?: number
  inThread?: number
  side?: true
  thread?: { replies: number; last: number; people: string[] }
  task?: number
  prs?: PullRequest[]
  images?: (Image | ImageSpot)[]
  docMedia?: BlockFiles
  reactions?: Reaction[]
  ask?: string
  system?: boolean
  github?: readonly GithubNote[]
  done?: true
  pending?: boolean
  failed?: string
  mentionsYou?: boolean
  leftOut?: string
  fromDoc?: true
  receipt?: string
  edited?: number
  deleted?: true
  canChange?: true
  partial?: true
}

export interface PermissionAsk {
  kind: "permission"
  id: string
  from: string
  at: number
  expiresAt?: number
  canAllow: boolean
  canDeny: boolean
  allower?: string
  tool: string
  title: string
  summary?: string
  code: string
  cwd?: string
  notes: string[]
  replaced?: string
  content?: string
  task?: number
  answer?: { allow: boolean; by: string; at: number }
}

export interface QuestionAsk {
  kind: "question"
  id: string
  from: string
  at: number
  text: Words
  label: string
  irreversible?: true
  options: Words[]
  holds: number[]
  task?: number
  idle?: true
  step?: Step
  handoff?: { url: string; label: string; expiresAt: number }
  answer?: { text: Words; by: string; at: number } & ({ shownIn: "card" } | { shownIn: "feed"; seq: number })
  closed?: { by: string; at: number; why?: Words }
  askedOf?: string[]
}

export interface JoinAsk {
  kind: "join"
  id: string
  at: number
  name: string
  who: Kind
  harness?: Harness
  runs?: string
  machine?: string
  forgotten?: true
  revoked?: true
  sponsor?: string
  key?: string
  said?: { machine?: string; tools?: string[]; repo?: string; outside: boolean } | "nothing"
  pin?: { name: string; persona: string | null | undefined }
  freeName?: string
  code: string
  check?: "unchecked" | "waiting" | "ready"
  answer?: { letIn: boolean; by: string; at: number }
}

export interface Powers {
  addsAgents: boolean
  answersDecisions: boolean
  managesAgents: boolean
}

export const NO_POWERS: Powers = { addsAgents: false, answersDecisions: false, managesAgents: false }
export const ALL_POWERS: Powers = { addsAgents: true, answersDecisions: true, managesAgents: true }
export const trusted = (p: Powers): boolean => p.addsAgents && p.answersDecisions && p.managesAgents

export interface JoinChoice {
  as?: string
  color?: Color | null
  persona?: string | null
  readOnly?: boolean
  powers?: Powers
}

export interface ReviewAsk {
  kind: "review"
  id: string
  at: number
  from: string
  task: number
}

export interface BypassAsk {
  kind: "bypass"
  id: string
  at: number
  from: string
  task: number
  missing: string[]
}

export type Ask = PermissionAsk | QuestionAsk | JoinAsk | ReviewAsk | SpecAsk | BypassAsk

export type HomeAct =
  | { kind: "options"; options: { shown: string; answer: string }[] }
  | { kind: "allow" }
  | { kind: "approve-spec"; ask: number; v: number }
  | { kind: "approve-task"; task: number }
  | { kind: "open" }

export interface HomeAsk {
  id: string
  at: number
  what: string
  text: string
  act: HomeAct
}

export interface HomeTask {
  id: number
  title: string
  who: string | null
  state: string
  busy: boolean
  red: boolean
}

export interface HomeAgent {
  name: string
  nick: string
  state: "working" | "waiting" | "idle" | "away"
  doing: string
  since?: number
  task: { id: number; title: string } | null
}

export interface HomeLine {
  from: string
  at: number
  text: string
}

export interface HomeChannel {
  code: string
  title: string
  lead: string | null
  leadName: string | null
  working: number
  asks: HomeAsk[]
  moving: HomeTask[]
  more: number
  doneToday: number
  red: number
  agents: HomeAgent[]
  said: HomeLine | null
  loading?: true
}

export interface ChannelTile {
  code: string
  title: string
  icon?: string
  state: "member" | "waiting" | "gone"
  unread: number
  needsYou: number
  last: number
  muted?: true
}

export interface InviteInfo {
  code: string
  owner: string | null
  state: "ok" | "gone" | "member"
}

export type UpdateCheck = { state: "current"; version: string } | { state: "failed" } | { state: "downloading" | "ready" | "available"; version: string; blocked?: boolean }

interface Fact {
  key: string
  value: string
  by: string
  at: number
}

export interface Compacted {
  summary: string
  through: number
  by: string
  at: number
  seq: number
}

export interface Channel {
  code: string
  title: string
  icon?: string
  youOwn: boolean
  youManageAgents?: boolean
  youTrusted?: boolean
  you: string
  lead?: string
  goal?: string
  facts?: Fact[]
  next?: string
  mergedAt?: number[]
  hold?: { note?: string; by: string; at: number }
  compact?: Compacted
  proposal?: Compacted
  newMembers?: "read" | "write"
  newPowers?: Powers
  repos: string[]
  reviewNotRequired?: string[]
  prs?: PullRequest[]
  issues?: Issue[]
  github?: GithubHealth
  githubWrite?: boolean
  branchPrefix?: string
  landing?: string
  peopleMerge?: true
  rooms: Room[]
  directs: Direct[]
  threads?: ThreadItem[]
  follows?: Readonly<Record<number, boolean>>
  theirs: TheirDirect[]
  people: Person[]
  former?: Person[]
  nicknames: ReadonlyMap<string, string>
  messages: Message[]
  since?: number
  leftOut?: Message[]
  tasks: Task[]
  taskGroups: TaskGroup[]
  specs?: Spec[]
  specsOnly?: true
  free?: string[]
  asks: Ask[]
  connection: "connecting" | "live" | "reconnecting"
  docs?: Readonly<Record<string, string>>
  loading?: boolean
  waiting?: { code: string; since: number; state?: "waiting" | "unreachable" | "declined"; owner?: string }
}

export interface Computer {
  id: string
  label: string
  os: "mac" | "linux" | "windows" | "iphone" | "android"
  thisOne: boolean
  online: boolean
  agents: number
  lastSeen: number
  holds?: string[]
}

export interface Account {
  name: string
  handle?: string
  email?: string
  github?: { login: string }
  githubSignIn?: boolean
  computers: Computer[]
  version: string
  update?: { version: string; ready: boolean; state?: "downloading" | "ready" | "available"; progress?: number; blocked?: true }
  uiUpdate?: { version: string }
  moved?: { from?: string; to: string }
  key?: string
  personPk?: string
  relay?: string
  keysUnsealed?: boolean
  desktop?: boolean
  enrollAsk?: EnrollAsk
  enrollError?: string
  devices?: Device[]
  forgotten?: { label: string; by: string; at: number }[]
  forgotHere?: { by: string }
  githubCode?: { code: string; url: string }
}

export interface EnrollAsk {
  id: string
  label: string
  os: string
  as: "desktop" | "phone" | "computer"
  stage: "new" | "waiting" | "digits" | "elsewhere"
  fingerprint?: string | null
}

export type Enrolling = { stage: "asking" } | { stage: "digits"; digits: string } | { stage: "check"; person: { name: string; fingerprint: string } }

export interface Device {
  id: string
  label: string
  os: string
  as: "desktop" | "phone" | "computer"
  until: number
  thisOne: boolean
  app?: string
}

export type Theme = "system" | "dark" | "light"

export type Appearance = "dark" | "light"

export interface ThemeBase {
  background: string
  text: string
  accent: string
  success?: string
  warning?: string
  danger?: string
  info?: string
  red?: string
  yellow?: string
  green?: string
  cyan?: string
  blue?: string
  magenta?: string
}

export interface CustomTheme {
  id: string
  name: string
  appearance: Appearance
  base: ThemeBase
}

export interface Prefs {
  theme: Theme
  textSize: number
  font: TextFont
  reduceMotion: boolean
  muted: string[]
  enterSends: boolean
  darkTheme: string
  lightTheme: string
  customThemes: CustomTheme[]
  folders: Folder[]
  calm: number
}

export interface SendExtras {
  replyTo?: number
  inThread?: number
  side?: true
  images?: Upload[]
  block?: DocBlockRef
}

export interface Folder {
  id: string
  name: string
  codes: string[]
  open: boolean
}

export interface Actions {
  send(code: string, where: Where, text: string, opts?: SendExtras): Promise<boolean>
  retry(code: string, seq: number): void
  loadImage(code: string, spot: string): void
  discard(code: string, seq: number): void
  markRead(code: string, where: Where): void
  followThread(code: string, root: number, on: boolean): void
  openDoc(code: string, thread: string, th: string | null, on: (e: DocEvent) => void): PipeIn
  findDoc(code: string, thread: string): Promise<string | null>
  docVersions(code: string, th: string): Promise<DocVersion[]>
  restoreDocVersion(code: string, thread: string, th: string, upto: number): Promise<boolean>
  putDocImage(code: string, upload: Upload): Promise<DocImage>
  putDocFile(code: string, upload: Upload): Promise<DocFile>
  docImage(code: string, img: DocImage): Promise<string | null>
  docFile(code: string, f: DocFile): Promise<string | null>
  leaveRoom(code: string, room: string): void
  react(code: string, seq: number, emoji: string): void
  editMessage(code: string, seq: number, text: string): void
  deleteMessage(code: string, seq: number): void
  answerPermission(code: string, id: string, allow: boolean): void
  answerQuestion(code: string, id: string, text: string): void
  answerStep(code: string, id: string, reply: StepReply): void
  answerJoin(code: string, id: string, letIn: boolean, choice?: JoinChoice): void
  approveTask(code: string, task: number, approve: boolean, why?: string): void
  addTask(code: string, ask: number, title: string): void
  setTaskStatus(code: string, task: number, status: TaskStatus): void
  cancelTask(code: string, task: number, why: string): void
  closeTask(code: string, task: number, why: string): void
  editTask(code: string, task: number, change: { title?: string; detail?: string }): void
  deleteTask(code: string, task: number): void
  assignTask(code: string, task: number, to: string, why: string): void
  setReviewer(code: string, task: number, reviewer: string): void
  nameGoal(code: string, ask: number, name: string | null): void
  newSpec(code: string, words: string, text: string): Promise<number | null>
  writeSpec(code: string, ask: number, text: string): void
  approveSpec(code: string, ask: number, v: number): void
  judgeSpec(code: string, ask: number, verdict: "accepted" | "back" | "dropped", note?: string): void
  deleteSpec(code: string, ask: number): void
  setSpecsOnly(code: string, on: boolean): void
  setRole(code: string, name: string, role: string | null): void
  removeMember(code: string, name: string): void
  setPersona(code: string, name: string, persona: string | null): void
  setReadOnly(code: string, name: string, on: boolean): void
  setWake(code: string, name: string, on: boolean): void
  setNickname(code: string, name: string, nickname: string | null): void
  setAgentColor(code: string, name: string, color: Color | null): void
  setPowers(code: string, name: string, powers: Partial<Powers>): void
  addRoom(code: string, name: string, members?: string[]): Promise<string | null>
  renameRoom(code: string, id: string, name: string): void
  setRoomMembers(code: string, id: string, members: string[]): Promise<boolean>
  setIcon(code: string, file: File | null): void
  renameChannel(code: string, title: string): void
  clearFact(code: string, key: string): void
  setGithubWrite(code: string, on: boolean): void
  setBranchPrefix(code: string, prefix: string | null): void
  setLanding(code: string, then: string | null): void
  setPeopleMerge(code: string, on: boolean): void
  exportHistory(code: string, kind: "transcript" | "log"): Promise<void>
  setGoal(code: string, goal: string): void
  setHold(code: string, on: boolean, note?: string): void
  askCompact(code: string): void
  approveCompact(code: string, proposal: number): void
  addRepo(code: string, repo: string): void
  myRepos(): Promise<string[]>
  removeRepo(code: string, repo: string): void
  inviteLink(code: string): Promise<string>
  joinCommand(code: string, as: { nick?: string; persona?: string }): Promise<string>
  leaveChannel(code: string): void
  newChannel(title: string): Promise<string>
  inviteInfo(typed: string): Promise<InviteInfo>
  joinChannel(code: string, name?: string): Promise<string>
  setName(name: string): void
  setPrefs(prefs: Partial<Prefs>): void
  setMute(code: string, room: string | null, on: boolean): void
  searchOlder(code: string, query: string, before: number): Promise<OlderSearch>
  olderAround(code: string, seq: number): Promise<OlderHit[] | null>
  fetchOlder(code: string, got: (asked: number) => void): Promise<void>
  earlier(code: string): Promise<boolean>
  earlierTo(code: string, seq: number): Promise<boolean>
  holdEarlier(code: string, key: string, seq: number | null): void
  forgetComputer(id: string): void
  linkGithub(): void
  signInWithGithub(): void
  unlinkGithub(): void
  installUpdate(): void
  checkUpdate(): Promise<UpdateCheck | null>
  setRelay(url: string): Promise<string | null>
  windowControl(action: "minimize" | "maximize" | "close"): void
  applyUi(): void
  dismissMoved(): void
  signOut(): void
  setNewMembers(code: string, can: "read" | "write"): void
  setNewPowers(code: string, powers: Powers): void
  enrollAnswer(id: string): void
  enrollConfirm(id: string, digits: string): Promise<{ ok: true } | { ok: false; left: number }>
  enrollDeny(id: string): void
  forgetDevice(ids: string[], keep?: KeptAgent[]): void
  renewDevice(...ids: string[]): void
  enrollBegin(): void
  enrollKeep(): void
  enrollCancel(): void
  closeChannel(code: string): void
  saveTheme(theme: CustomTheme): void
  deleteTheme(id: string): void
  savePersonalities(list: Personality[]): void
  setHooks(harness: HookHarness, on: boolean): void
  checkComputer(): Promise<Finding[] | null>
  setContextLine(on: boolean): void
  computerSettings(id: string): Promise<[string, string[]][]>
  launchedFrom(ids: string[]): Promise<LaunchedAgent[]>
}

export type Finding = { ok: true; what: string } | { ok: false; what: string; how: string }

export interface ThisComputer {
  kiwi: { running: boolean; version?: string }
  hooks: { harness: HookHarness; label: string; state: Exclude<HookState, "absent"> }[]
  contextLine: boolean | null
}

export interface GoneChannel {
  code: string
  title: string
  why: "closed" | "removed"
}

export interface App {
  account: Account | null
  channels: ChannelTile[]
  home: HomeChannel[]
  channel: Channel | null
  gone?: GoneChannel
  prefs: Prefs
  harnesses: { id: Harness; label: string; installed: boolean; version?: string; path?: string }[]
  personas: { id: string; label: string; about: string }[]
  ownPersonalities: Personality[]
  computer: ThisComputer | null
  enrolling?: Enrolling | null
  signIn?: GithubSignIn | null
  actions: Actions
}

/** Signing in with GitHub, the first thing on a relay that takes it: where it stands. */
export type GithubSignIn = { stage: "checking" } | { stage: "sign-in"; code: { code: string; url: string } | null; problem: string | null } | { stage: "signed-in"; login: string }

export const inSpecThread = (m: Pick<Message, "inThread">, specAsks: ReadonlySet<number>): boolean => m.inThread !== undefined && specAsks.has(m.inThread)

export function memberOf(channel: Pick<Channel, "people" | "former">, name: string): Person | undefined {
  return channel.people.find((p) => p.name === name) ?? channel.former?.find((p) => p.name === name)
}

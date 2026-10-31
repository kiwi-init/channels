import type { TextFont } from "@kiwi/app/theme.ts"
import type { HookHarness, HookState } from "@kiwi/core/harnesses.ts"
import type { Personality } from "@kiwi/core/personality.ts"
import type { GithubNote, Step, StepReply } from "@kiwi/core/protocol.ts"
import type { PlacedSeat, TerminalId, TerminalRow } from "@kiwi/core/terminals.ts"

export type Harness = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "grok" | "kimi" | "mimo" | "pi" | "grok-bot" | "zcode" | "other"

type Presence = "online" | "away" | "offline"

export type TaskStatus = "todo" | "doing" | "review" | "done" | "waiting"

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
  about?: string
  load?: Load
  readOnly?: boolean
  wakes?: boolean
  seat?: PlacedSeat["place"]
  attach?: string
  addsAgents?: boolean
  answersDecisions?: boolean
  managesAgents?: boolean
  ops?: Readonly<Record<string, number>>
  opsLive?: number
  lastSeen: number
  joined: number
  messages: number
  left?: boolean
}

export interface PullRequest {
  repo: string
  number: number
  title: string
  url: string
  state: "open" | "draft" | "merged" | "closed"
  checks: "pass" | "fail" | "running" | "none"
  ticks?: { passed: number; running: number; failed: readonly string[] }
  mergedAt?: number
  additions?: number
  deletions?: number
}

interface TaskNote {
  by: string
  at: number
  text: string
}

export interface ReviewRound {
  n: number
  by: string
  judge?: string
  at: number
  result: "open" | "approved" | "rejected" | "withdrawn"
  summary?: string
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
  note?: string
  where?: Where
  root?: number
}

export interface Task {
  id: number
  title: string
  detail?: string
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
  youReview?: "verdict" | "send-back"
  suggested?: { name: string; why: string }
  leftBy?: string
}

export type TaskGroupHead =
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

export type Where = { kind: "room"; room: string } | { kind: "dm"; with: string } | { kind: "theirs"; between: readonly [string, string] } | { kind: "task"; task: number }

export interface Room {
  id: string
  name: string
  unread: number
  mentions: number
  seen?: number
  members?: string[]
}

export interface Direct {
  with: string
  unread: number
  last: number
  seen?: number
}

export interface TheirDirect {
  between: readonly [string, string]
  last: number
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

export interface Message {
  seq: number
  from: string
  at: number
  text: string
  where: Where
  said?: Said
  replyTo?: number
  inThread?: number
  thread?: { replies: number; last: number; people: string[] }
  task?: number
  prs?: PullRequest[]
  images?: (Image | ImageSpot)[]
  reactions?: Reaction[]
  ask?: string
  system?: boolean
  github?: readonly GithubNote[]
  done?: true
  pending?: boolean
  failed?: string
  mentionsYou?: boolean
  leftOut?: string
  receipt?: string
  edited?: number
  deleted?: true
  canChange?: true
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
  text: string
  label: string
  irreversible?: true
  options: string[]
  holds: number[]
  task?: number
  idle?: true
  step?: Step
  handoff?: { url: string; label: string; expiresAt: number }
  answer?: { text: string; by: string; at: number }
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

export type Ask = PermissionAsk | QuestionAsk | JoinAsk | ReviewAsk

export interface ChannelTile {
  code: string
  title: string
  icon?: string
  state: "member" | "waiting" | "gone"
  unread: number
  needsYou: number
  last: number
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

interface TermScreen {
  cols: number
  rows: number
  seed: string
  dead: boolean
  pane?: string
}

export interface TermTab {
  pane: string
  label: string
}

export interface TermWatch {
  out(text: string): void
  ended(): void
}

export interface TermLink {
  keys(text: string): void
  size(cols: number, rows: number): void
  close(): void
}

export type TermOpened = { screen: TermScreen; link: TermLink } | { error: string }

export type ComputerChoices = { harnesses?: App["harnesses"]; folders: string[] } | { error: string }

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
  githubWrite?: boolean
  branchPrefix?: string
  rooms: Room[]
  directs: Direct[]
  theirs: TheirDirect[]
  people: Person[]
  former?: Person[]
  nicknames: ReadonlyMap<string, string>
  messages: Message[]
  leftOut?: Message[]
  tasks: Task[]
  taskGroups: TaskGroup[]
  asks: Ask[]
  connection: "connecting" | "live" | "reconnecting"
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
  githubMove?: string
  computers: Computer[]
  version: string
  update?: { version: string; ready: boolean; state?: "downloading" | "ready" | "available" }
  uiUpdate?: { version: string }
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
  notify: "all" | "mentions" | "none"
  enterSends: boolean
  darkTheme: string
  lightTheme: string
  customThemes: CustomTheme[]
  folders: Folder[]
}

export interface Folder {
  id: string
  name: string
  codes: string[]
  open: boolean
}

export interface NewAgent {
  harness: Harness
  computer: string
  folder: string
  name: string
  persona?: string
  role?: string
  mode?: "ask-first" | "accept-edits" | "dont-ask"
}

export type Launching = { stage: "started" } | { stage: "asked"; name: string } | { stage: "joined"; name: string } | { stage: "failed"; why: string }

export interface Actions {
  send(code: string, where: Where, text: string, opts?: { replyTo?: number; inThread?: number; images?: Upload[] }): void
  retry(code: string, seq: number): void
  loadImage(code: string, spot: string): void
  discard(code: string, seq: number): void
  react(code: string, seq: number, emoji: string): void
  editMessage(code: string, seq: number, text: string): void
  deleteMessage(code: string, seq: number): void
  answerPermission(code: string, id: string, allow: boolean): void
  answerQuestion(code: string, id: string, text: string): void
  answerStep(code: string, id: string, reply: StepReply): void
  answerJoin(code: string, id: string, letIn: boolean, choice?: JoinChoice): void
  approveTask(code: string, task: number, approve: boolean, why?: string): void
  addTask(code: string, title: string, owner?: string): void
  setTaskStatus(code: string, task: number, status: TaskStatus): void
  cancelTask(code: string, task: number, why: string): void
  assignTask(code: string, task: number, to: string, why: string): void
  setReviewer(code: string, task: number, reviewer: string): void
  nameGoal(code: string, ask: number, name: string | null): void
  setRole(code: string, name: string, role: string | null): void
  removeMember(code: string, name: string): void
  setPersona(code: string, name: string, persona: string | null): void
  setReadOnly(code: string, name: string, on: boolean): void
  setWake(code: string, name: string, on: boolean): void
  setNickname(code: string, name: string, nickname: string | null): void
  setPowers(code: string, name: string, powers: Partial<Powers>): void
  addAgent(code: string, agent: NewAgent, seen: (s: Launching) => void): () => void
  showAgent(code: string, name: string): Promise<string | null>
  openTerm(code: string, name: string, cols: number, rows: number, watch: TermWatch): Promise<TermOpened>
  openMyTerm(code: string, want: string | null, cols: number, rows: number, watch: TermWatch): Promise<TermOpened>
  myTerms(): Promise<TermTab[]>
  closeMyTerm(pane: string): Promise<TermTab[]>
  choicesOn(code: string, computer: string): Promise<ComputerChoices>
  chooseFolder(): Promise<string | null>
  addRoom(code: string, name: string, members?: string[]): Promise<string | null>
  renameRoom(code: string, id: string, name: string): void
  setRoomMembers(code: string, id: string, members: string[]): void
  setIcon(code: string, file: File | null): void
  renameChannel(code: string, title: string): void
  clearFact(code: string, key: string): void
  setGithubWrite(code: string, on: boolean): void
  setBranchPrefix(code: string, prefix: string | null): void
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
  forgetComputer(id: string): void
  linkGithub(): void
  signInWithGithub(): void
  unlinkGithub(): void
  installUpdate(): void
  checkUpdate(): Promise<UpdateCheck | null>
  setRelay(url: string): Promise<string | null>
  windowControl(action: "minimize" | "maximize" | "close"): void
  applyUi(): void
  signOut(): void
  setNewMembers(code: string, can: "read" | "write"): void
  setNewPowers(code: string, powers: Powers): void
  enrollAnswer(id: string): void
  enrollConfirm(id: string, digits: string): Promise<{ ok: true } | { ok: false; left: number }>
  enrollDeny(id: string): void
  forgetDevice(id: string): void
  renewDevice(id: string): void
  enrollBegin(): void
  enrollKeep(): void
  enrollCancel(): void
  closeChannel(code: string): void
  saveTheme(theme: CustomTheme): void
  deleteTheme(id: string): void
  addStartFolder(): void
  removeStartFolder(dir: string): void
  allowNewAgents(on: boolean): void
  allowRemoteBypass(on: boolean): void
  savePersonalities(list: Personality[]): void
  setHooks(harness: HookHarness, on: boolean): void
  checkComputer(): Promise<Finding[] | null>
  setTerminalHelpers(id: TerminalId, on: boolean): void
  setContextLine(on: boolean): void
  computerSettings(id: string): Promise<[string, string[]][]>
}

export type Finding = { ok: true; what: string } | { ok: false; what: string; how: string }

export interface ThisComputer {
  kiwi: { running: boolean; version?: string }
  hooks: { harness: HookHarness; label: string; state: Exclude<HookState, "absent"> }[]
  contextLine: boolean | null
}

export interface AgentStarts {
  folders: string[]
  launch: boolean
  bypass: boolean
  terminals: TerminalRow[]
}

export interface GoneChannel {
  code: string
  title: string
  why: "closed" | "removed"
}

export interface App {
  account: Account | null
  channels: ChannelTile[]
  channel: Channel | null
  gone?: GoneChannel
  prefs: Prefs
  harnesses: { id: Harness; label: string; installed: boolean; version?: string; path?: string; why?: string }[]
  personas: { id: string; label: string; about: string }[]
  starts: AgentStarts | null
  ownPersonalities: Personality[]
  computer: ThisComputer | null
  enrolling?: Enrolling | null
  signIn?: GithubSignIn | null
  actions: Actions
}

/** Signing in with GitHub, the first thing on a relay that takes it: where it stands. */
export type GithubSignIn = { stage: "checking" } | { stage: "sign-in"; code: { code: string; url: string } | null; problem: string | null } | { stage: "signed-in"; login: string }

export function memberOf(channel: Pick<Channel, "people" | "former">, name: string): Person | undefined {
  return channel.people.find((p) => p.name === name) ?? channel.former?.find((p) => p.name === name)
}

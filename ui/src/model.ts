import type { HookState, KnownHarness } from "@kiwi/core/harnesses.ts"
import type { Personality } from "@kiwi/core/personality.ts"
import type { Step, StepReply } from "@kiwi/core/protocol.ts"
import type { TerminalId, TerminalRow } from "@kiwi/core/terminals.ts"

export type Harness = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "grok" | "kimi" | "mimo" | "pi" | "grok-bot" | "zcode" | "other"

type Presence = "online" | "away" | "offline"

export type TaskStatus = "todo" | "doing" | "review" | "done" | "waiting"

type Kind = "human" | "agent"

export type Color = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "violet" | "pink" | "brown"

export interface Person {
  name: string
  kind: Kind
  display?: string
  role?: string
  color?: Color
  picture?: string
  owner: boolean
  you: boolean
  presence: Presence
  typing: boolean
  harness?: Harness
  runs?: string
  model?: string
  machine?: string
  folder?: string
  persona?: string
  sponsor?: string
  about?: string
  doing?: number
  readOnly?: boolean
  wakes?: boolean
  seat?: "rex" | "tmux"
  addsAgents?: boolean
  answersDecisions?: boolean
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
  notes: TaskNote[]
  rounds: ReviewRound[]
  archived: boolean
  cancelled?: boolean
  youReview?: "verdict" | "send-back"
}

export type Where = { kind: "room"; room: string } | { kind: "dm"; with: string } | { kind: "task"; task: number }

export interface Room {
  id: string
  name: string
  unread: number
  mentions: number
  seen?: number
}

export interface Direct {
  with: string
  unread: number
  last: number
  seen?: number
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

export interface Reaction {
  emoji: string
  by: string[]
}

export interface Message {
  seq: number
  from: string
  at: number
  text: string
  where: Where
  replyTo?: number
  inThread?: number
  thread?: { replies: number; last: number; people: string[] }
  task?: number
  pr?: PullRequest
  images?: Image[]
  reactions?: Reaction[]
  ask?: string
  system?: boolean
  pending?: boolean
  failed?: string
  mentionsYou?: boolean
}

export interface PermissionAsk {
  kind: "permission"
  id: string
  from: string
  at: number
  tool: string
  summary: string
  code: string
  task?: number
  answer?: { allow: boolean; by: string; at: number }
}

export interface QuestionAsk {
  kind: "question"
  id: string
  from: string
  at: number
  text: string
  options: string[]
  holds: number[]
  task?: number
  idle?: true
  step?: Step
  answer?: { text: string; by: string; at: number }
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
}

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

export type ComputerChoices = { harnesses?: App["harnesses"]; folders: string[] } | { error: string }

export interface Channel {
  code: string
  title: string
  icon?: string
  youOwn: boolean
  you: string
  lead?: string
  goal?: string
  facts?: Fact[]
  hold?: { note?: string; by: string; at: number }
  newMembers?: "read" | "write"
  newPowers?: Powers
  repos: string[]
  githubWrite?: boolean
  branchPrefix?: string
  rooms: Room[]
  directs: Direct[]
  people: Person[]
  former?: Person[]
  nicknames: ReadonlyMap<string, string>
  messages: Message[]
  tasks: Task[]
  asks: Ask[]
  connection: "connecting" | "live" | "reconnecting"
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
  computers: Computer[]
  version: string
  update?: { version: string; ready: boolean; state?: "downloading" | "ready" | "available" }
  uiUpdate?: { version: string }
  key?: string
  relay?: string
  keysUnsealed?: boolean
  desktop?: boolean
  pairAsk?: { kind: "computer" | "phone"; label: string; os?: string; digits?: string }
  enrollAsk?: EnrollAsk
  devices?: Device[]
  githubCode?: { code: string; url: string }
}

export interface EnrollAsk {
  id: string
  label: string
  os: string
  as: "desktop" | "phone" | "computer"
  stage: "new" | "waiting" | "digits" | "elsewhere"
}

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
  reduceMotion: boolean
  notify: "all" | "mentions" | "none"
  enterSends: boolean
  darkTheme: string
  lightTheme: string
  customThemes: CustomTheme[]
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

export interface Actions {
  send(code: string, where: Where, text: string, opts?: { replyTo?: number; inThread?: number; images?: Upload[] }): void
  retry(code: string, seq: number): void
  discard(code: string, seq: number): void
  react(code: string, seq: number, emoji: string): void
  answerPermission(code: string, id: string, allow: boolean): void
  answerQuestion(code: string, id: string, text: string): void
  answerStep(code: string, id: string, reply: StepReply): void
  answerJoin(code: string, id: string, letIn: boolean, choice?: JoinChoice): void
  approveTask(code: string, task: number, approve: boolean, why?: string): void
  addTask(code: string, title: string, owner?: string): void
  setTaskStatus(code: string, task: number, status: TaskStatus): void
  setRole(code: string, name: string, role: string | null): void
  removeMember(code: string, name: string): void
  setPersona(code: string, name: string, persona: string | null): void
  setReadOnly(code: string, name: string, on: boolean): void
  setWake(code: string, name: string, on: boolean): void
  setNickname(code: string, name: string, nickname: string | null): void
  setColor(code: string, name: string, color: Color | null): void
  setPowers(code: string, name: string, powers: Partial<Powers>): void
  addAgent(code: string, agent: NewAgent): void
  showAgent(code: string, name: string): Promise<string | null>
  choicesOn(code: string, computer: string): Promise<ComputerChoices>
  chooseFolder(): Promise<string | null>
  addRoom(code: string, name: string): void
  renameRoom(code: string, id: string, name: string): void
  setIcon(code: string, file: File | null): void
  renameChannel(code: string, title: string): void
  clearFact(code: string, key: string): void
  setGithubWrite(code: string, on: boolean): void
  setBranchPrefix(code: string, prefix: string | null): void
  exportHistory(code: string, kind: "transcript" | "log"): Promise<void>
  setGoal(code: string, goal: string): void
  setHold(code: string, on: boolean, note?: string): void
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
  pairBegin(kind: "computer" | "phone"): Promise<string>
  forgetComputer(id: string): void
  linkGithub(): void
  unlinkGithub(): void
  installUpdate(): void
  checkUpdate(): Promise<UpdateCheck | null>
  setRelay(url: string): Promise<string | null>
  windowControl(action: "minimize" | "maximize" | "close"): void
  applyUi(): void
  signOut(): void
  setNewMembers(code: string, can: "read" | "write"): void
  setNewPowers(code: string, powers: Powers): void
  answerPair(accept: boolean): void
  cancelPair(): void
  enrollAnswer(id: string): void
  enrollConfirm(id: string, digits: string): Promise<{ ok: true } | { ok: false; left: number }>
  enrollDeny(id: string): void
  forgetDevice(id: string): void
  renewDevice(id: string): void
  closeChannel(code: string): void
  saveTheme(theme: CustomTheme): void
  deleteTheme(id: string): void
  addStartFolder(): void
  removeStartFolder(dir: string): void
  allowNewAgents(on: boolean): void
  allowRemoteBypass(on: boolean): void
  savePersonalities(list: Personality[]): void
  setHooks(harness: KnownHarness, on: boolean): void
  checkComputer(): Promise<Finding[] | null>
  preferTerminal(id: TerminalId): void
  setTerminalHelpers(id: Exclude<TerminalId, "app">, on: boolean): void
  setContextLine(on: boolean): void
  computerSettings(id: string): Promise<[string, string[]][]>
}

export type Finding = { ok: true; what: string } | { ok: false; what: string; how: string }

export interface ThisComputer {
  kiwi: { running: boolean; version?: string }
  hooks: { harness: KnownHarness; label: string; state: Exclude<HookState, "absent"> }[]
  contextLine: boolean | null
}

export interface AgentStarts {
  folders: string[]
  launch: boolean
  bypass: boolean
  prefer: TerminalId
  terminals: TerminalRow[]
}

export interface App {
  account: Account | null
  channels: ChannelTile[]
  channel: Channel | null
  prefs: Prefs
  harnesses: { id: Harness; label: string; installed: boolean; version?: string; path?: string; why?: string }[]
  personas: { id: string; label: string; about: string }[]
  starts: AgentStarts | null
  ownPersonalities: Personality[]
  computer: ThisComputer | null
  actions: Actions
}

export function memberOf(channel: Pick<Channel, "people" | "former">, name: string): Person | undefined {
  return channel.people.find((p) => p.name === name) ?? channel.former?.find((p) => p.name === name)
}

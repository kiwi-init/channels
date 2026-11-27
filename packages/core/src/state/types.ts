import type { Authors } from "./authors.ts";
import type { Member as MemberRecord, Runs } from "../membership.ts";
import type { LandingStep, StepSpec } from "../steps.ts";
import type { Card, CheckpointOwed, Color, IssueRef, KeptHow, Landing, MemberPicture, Message, SpecVerdict, TaskState, Trust, Verdict } from "../protocol.ts";
import type { CheckpointDaily } from "../checkpoint-schedule.ts";
import type { GithubCheck, GithubIssue, GithubPr, GithubRelease, GithubRules, GithubRun, GithubState } from "./github.ts";
import type { TaskSnapshot } from "../task-snapshot.ts";
import type { Persona } from "../personality.ts";
import type { Power } from "../protocol.ts";
import type { RoomMember, RoomMeta, RoomSeal } from "../room-rules.ts";
import type { Scope } from "../scopes.ts";
import type { CheckState } from "./checks.ts";
export interface Member {
  name: string;
  kind?: "human" | "agent" | "computer";
  display?: string;
  sponsor?: { user: string; name: string; handle?: string };
  pk: string;
  color?: Color;
  picture?: MemberPicture;
  scopes: Scope[];
  card?: Card & { at: number };
  runs?: Runs;
  persona?: Persona;
  addsAgents?: boolean;
  answersDecisions?: boolean;
  managesAgents?: boolean;
  owner: boolean;
  joined: number;
  active: boolean;
  lastSeen: number;
  messages: number;
  ops?: Record<string, number>;
  reset?: ResetMark;
}

type ResetMark = { kind: "waived" } | { kind: "needs"; verdict: number; session: string };

export type FoldMember = Member & { role?: string; about?: string };

export interface Nickname {
  seq: number;
  nickname: string | null;
}

export type Roster = {
  name: string;
  pk: string;
  role?: string;
  about?: string;
  owner: boolean;
  at: number;
  active: boolean;
  kind?: "human" | "agent" | "computer";
  display?: string;
  sponsor?: { user: string; name: string; handle?: string };
  color?: Color;
  scopes?: Scope[];
  later?: { scopes: Scope[]; since: number };
  laterRole?: { role: string | null; about?: string | null; since: number };
  runs?: Runs;
  persona?: Persona;
  addsAgents?: boolean;
  answersDecisions?: boolean;
  managesAgents?: boolean;
}[];

export const toRoster = (m: MemberRecord): Roster[number] => ({
  name: m.name,
  pk: m.pk,
  role: m.role,
  about: m.about,
  owner: m.owner,
  at: m.at,
  active: m.active,
  kind: m.kind,
  display: m.display,
  sponsor: m.sponsor,
  color: m.color,
  ...(m.scopes ? { scopes: m.scopes } : {}),
  ...(m.later ? { later: m.later } : {}),
  ...(m.laterRole ? { laterRole: m.laterRole } : {}),
  ...(m.runs ? { runs: m.runs } : {}),
  ...(m.persona ? { persona: m.persona } : {}),
  ...(m.addsAgents ? { addsAgents: true } : {}),
  ...(m.answersDecisions ? { answersDecisions: true } : {}),
  ...(m.managesAgents ? { managesAgents: true } : {}),
});

export const rosterOf = (members: readonly MemberRecord[]): Roster => members.filter((m) => !m.unverified).map(toRoster);

interface TaskNote {
  seq: number;
  by: string;
  ts: number;
  text: string;
  checkpoint?: true;
  assign?: true;
}

interface TaskProof {
  seq: number;
  by: string;
  ts: number;
  url: string;
  label?: string;
}

type RoundResult = { kind: "open" } | { kind: Verdict; by: string; seq: number; ts: number; rts?: number; runs?: number[] } | { kind: "withdrawn"; seq: number };

interface KeptHead {
  head: string;
  approved: string;
  how: KeptHow;
  repo: string;
  ref: string;
  tip: string;
  seq: number;
  by: string;
  rts?: number;
}

export interface ReviewRound {
  n: number;
  at?: string;
  summary?: string;
  by: string;
  seq: number;
  ts: number;
  rts?: number;
  result: RoundResult;
  stale?: number;
  kept?: KeptHead[];
}

export interface StepQuestion {
  seq: number;
  from: string;
  esc?: true;
  to?: string[];
  choices: string[];
}

export interface Woke {
  since: number;
  seq: number;
  by: string;
  at: number;
  delivered?: number;
  read?: number;
}

export interface TaskClock {
  key: string;
  seq: number;
  at: number;
  step?: 1 | 2 | 3;
  day?: number;
  head?: string;
  acts?: [name: string, seq: number, at: number, step?: 1 | 2 | 3][];
  woke?: Woke;
}

export interface Task {
  id: number;
  title: string;
  detail?: string;
  state: TaskState;
  owner?: string;
  createdBy: string;
  createdAt: number;
  createdRts?: number;
  updatedAt: number;
  notes: TaskNote[];
  proof?: TaskProof[];
  run?: { id: string; seq: number; by: string };
  review?: string;
  approvedBy?: string;
  cancelled?: boolean;
  closedWith?: string;
  closedSeq?: number;
  steps?: LandingStep[];
  stepCount?: number;
  lander?: string;
  issue?: IssueRef;
  from?: number;
  areas?: string[];
  touched?: Record<string, number>;
  clock?: TaskClock;
  workedBy: string[];
  rounds: ReviewRound[];
  source?: number;
  ask?: number;
  posters?: string[];
  archived?: boolean;
  leftBy?: string;
  handedOff?: { seq: number; from: string };
  first?: number;
  snapshot?: TaskSnapshot;
  wait?: TaskWait;
}

interface TaskWait {
  reason: string;
  by: string;
  seq: number;
  at: number;
  until?: number;
}

export interface AskHead {
  id: number;
  by: string;
  words: string;
  at: number;
  goal?: string;
  goalBy?: string;
}

interface SpecMark {
  seq: number;
  by: string;
  at: number;
}

export interface Spec {
  ask: number;
  text: string;
  v: number;
  by: string;
  at: number;
  started: SpecMark;
  edits: number;
  editors: string[];
  ready?: SpecMark & { v: number };
  approved?: SpecMark & { v: number; text: string };
  result?: SpecMark & { verdict: SpecVerdict; note?: string; auto?: true };
  backs: (SpecMark & { note: string })[];
  comments?: { seq: number; by: string }[];
  changes?: number[];
}

export interface Edit {
  body: string;
  at: number;
  seq: number;
}

export interface Reaction {
  emoji: string;
  seq: number;
  at: number;
}

export interface Lease {
  name: string;
  holder?: string;
  since: number;
  until: number;
  note?: string;
  queue: { name: string; ttl: number; joined: number; note?: string; task?: number }[];
}

export interface CheckpointAsk {
  seq: number;
  at: number;
  by: string;
  asks: CheckpointOwed[];
  unreachable: string[];
  occurrence: string | null;
}

export interface Fact {
  key: string;
  value: string;
  by: string;
  ts: number;
  seq: number;
  expires?: number;
}

export type Place = { kind: "main" } | { kind: "task"; task: number } | { kind: "dm"; with: [string, string] };

export interface PlaceSummary {
  place: Place;
  last: number;
  count: number;
  done?: boolean;
}

export type Frozen<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<K, Frozen<V>>
      : T extends ReadonlySet<infer V>
        ? ReadonlySet<Frozen<V>>
        : T extends readonly unknown[]
          ? { readonly [K in keyof T]: Frozen<T[K]> }
          : T extends object
            ? { readonly [P in keyof T]: Frozen<T[P]> }
            : T;

export type ChannelState = Frozen<ChannelStateDraft>;

export function thawed<T>(value: Frozen<T>): T;
export function thawed(value: unknown): unknown {
  return structuredClone(value);
}

export interface ChannelStateDraft {
  members: Map<string, Member>;
  tasks: Map<number, Task>;
  facts: Map<string, Fact>;
  docs: Map<string, string>;
  leases: Map<string, Lease>;
  trust: Map<number, Trust>;
  rejected: Map<number, string>;
  scopeSets: Map<string, { seq: number; scopes: Scope[]; persona?: Persona | null }>;
  roleSets: Map<string, { seq: number; role: string | null; about?: string | null }>;
  gone: Map<string, number>;
  nicknames: Map<string, Nickname>;
  openAsks: Message[];
  askHeads: Map<number, AskHead>;
  specs: Map<number, Spec>;
  specsOnly: number | null;
  duty: Duty | null;
  checkpoint: LeadCheckpoint | null;
  offDuty: OffDuty | null;
  standbys: Map<string, Standby>;
  homeLead: string | null;
  leadAsks: Map<number, LeadAsk>;
  leadOwned: Map<number, LeadOwned>;
  checks: Map<number, CheckState>;
  threadOf: Map<number, number>;
  threadPeople: Map<number, Set<string>>;
  lead: string | null;
  rooms: Map<string, Room>;
  secret: Map<string, SecretRoom>;
  roomOf: Map<number, string>;
  placeOf: Map<number, Place>;
  places: Map<string, PlaceSummary>;
  charter: Charter | null;
  repos: string[];
  github: GithubState;
  hold: Hold | null;
  githubWrite: number | null;
  branchPrefix: string | null;
  quietMs: number;
  reviewReset: boolean;
  tapToAnswer: boolean;
  checkpointDaily: CheckpointDaily | null;
  checkpointAsks: CheckpointAsk[];
  landing: Landing | null;
  landingSteps: StepSpec[] | null;
  compact: Compact | null;
  compactProposal: Compact | null;
  reactions: Map<number, Map<string, Reaction>>;
  edits: Map<number, Edit>;
  chatBy: Map<number, string>;
  deleted: Map<number, number>;
  head: number;
}

export interface Compact {
  summary: string;
  through: number;
  by: string;
  at: number;
  seq: number;
}

export interface Charter {
  text: string;
  by: string;
  at: number;
}

export interface Hold {
  note?: string;
  by: string;
  at: number;
}

export interface GuardFloor {
  charter: { text: string | null; since: number } | null;
  hold: { on: boolean; note?: string; since: number } | null;
  repos?: { list: string[]; since: number } | null;
}

export interface Room {
  id: string;
  name: string;
  createdBy: string | null;
  at: number;
  posters?: string[];
  members?: RoomMember[];
  dm?: true;
  self?: true;
}

export interface SecretRoom {
  n: number;
  seals: RoomSeal[];
  meta?: RoomMeta;
  leaving?: string[];
}

export type PersonaLead = boolean | "roster";

export interface Duty {
  lead: string;
  since: number;
  by: string;
}

export interface LeadCheckpoint {
  text: string;
  by: string;
  seq: number;
  at: number;
}

export type DutyNote =
  | { kind: "answer"; ask: number; by: string; seq: number; said: string }
  | { kind: "hold"; task: number; step: string; by: string; seq: number; reason: string }
  | { kind: "unhold"; task: number; step: string; by: string; seq: number }
  | { kind: "ticked"; ask: number; boxes: number; seq: number }
  | { kind: "closed"; task: number; title: string; seq: number };

export interface OffDuty {
  left: [string, number][];
  notes: DutyNote[];
}

export interface Standby {
  since: number;
  by: string;
}

export interface LeadAsk {
  sentTo: string;
  from: string;
  plain: boolean;
  answer?: { by: string; seq: number };
}

export interface LeadOwned {
  author: string;
  to: string[];
  esc: boolean;
  plain: boolean;
  answer?: { by: string; seq: number; to: string };
}

export interface FoldBase {
  n: number;
  members: {
    name: string;
    role?: string;
    about?: string;
    color?: Color;
    picture?: MemberPicture;
    card?: Card & { at: number };
    lastSeen: number;
    messages: number;
    ops?: Record<string, number>;
    reset?: ResetMark;
  }[];
  lead: string | null;
  charter: Charter | null;
  repos?: string[];
  github?: {
    prs: GithubPr[];
    checks: [string, GithubCheck[]][];
    issues?: GithubIssue[];
    rules?: GithubRules[];
    releases?: GithubRelease[];
    runs?: GithubRun[];
    runsSince?: number | null;
    runsForgotten?: number | null;
  };
  hold: Hold | null;
  voice?: boolean;
  githubWrite?: number | null;
  branchPrefix?: string | null;
  quietMs?: number;
  reviewReset?: true;
  tapToAnswer?: true;
  checkpointDaily?: CheckpointDaily;
  checkpointAsks?: CheckpointAsk[];
  landing?: Landing | null;
  landingSteps?: StepSpec[] | null;
  passedAsks?: [number, string][];
  stepQuestions?: StepQuestion[];
  compact: Compact | null;
  compactProposal: Compact | null;
  scopesByKey: [string, Scope[]][];
  scopeSets: [string, { seq: number; scopes: Scope[]; persona?: Persona | null }][];
  roleSets: [string, { seq: number; role: string | null; about?: string | null }][];
  gone?: [string, number][];
  nicknames?: [string, Nickname][];
  tasks: (Task & { then?: Landing; landed?: object })[];
  facts: Fact[];
  docs?: [string, string][];
  leases: Lease[];
  reactions: [number, [string, Reaction][]][];
  reactSeqs: number[];
  chatBy: [number, string][];
  authors?: Authors;
  edits: [number, Edit][];
  deleted: [number, number][];
  trust: [number, Trust][];
  rejected: [number, string][];
  sent?: ([string, number] | [string, number, number, number])[];
  oldSent?: [number, number][];
  sentKeys?: string[];
  sentFloors?: [string, number][];
  hw?: number;
  placesBefore?: [Place, number, number][];
  personaLeads?: [string, PersonaLead][];
  powers?: [string, Partial<Record<Power, boolean>>][];
  asks: Message[];
  askHeads?: AskHead[];
  specs?: Spec[];
  specsOnly?: number | null;
  duty?: Duty | null;
  checkpoint?: LeadCheckpoint | null;
  offDuty?: OffDuty | null;
  standbys?: [string, Standby][];
  leadAsks?: [number, LeadAsk][];
  leadOwned?: [number, LeadOwned][];
  checks?: CheckState[];
  answered: [number, string[]][];
  threadOf: [number, number][];
  threadPeople: [number, string[]][];
  rooms: Room[];
  secret?: [string, SecretRoom][];
  roomOf: [number, string][];
  placeOf: [number, Place][];
  folded?: number;
  rules?: number;
  skipped?: true;
}

export interface RoomsFloor {
  list: { id: string; name: string }[];
  since: number;
}

import type { Member as MemberRecord, Runs } from "../membership.ts";
import type { Card, Color, IssueRef, MemberPicture, Message, TaskState, Trust, Verdict } from "../protocol.ts";
import type { GithubCheck, GithubIssue, GithubPr, GithubRelease, GithubRules, GithubState } from "./github.ts";
import type { Persona } from "../personality.ts";
import type { Power } from "../protocol.ts";
import type { RoomMember, RoomMeta, RoomSeal } from "../room-rules.ts";
import type { Scope } from "../scopes.ts";
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
}

export type FoldMember = Member & { role?: string; about?: string };

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

type RoundResult = { kind: "open" } | { kind: Verdict; by: string; seq: number; ts: number } | { kind: "withdrawn"; seq: number };

export interface ReviewRound {
  n: number;
  at?: string;
  summary?: string;
  by: string;
  seq: number;
  ts: number;
  result: RoundResult;
}

export interface Task {
  id: number;
  title: string;
  detail?: string;
  state: TaskState;
  owner?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  notes: TaskNote[];
  proof?: TaskProof[];
  review?: string;
  approvedBy?: string;
  cancelled?: boolean;
  closedSeq?: number;
  issue?: IssueRef;
  from?: number;
  areas?: string[];
  touched?: Record<string, number>;
  workedBy: string[];
  rounds: ReviewRound[];
  source?: number;
  ask?: number;
  posters?: string[];
  archived?: boolean;
  leftBy?: string;
  handedOff?: { seq: number; from: string };
  first?: number;
}

export interface AskHead {
  id: number;
  by: string;
  words: string;
  at: number;
  goal?: string;
  goalBy?: string;
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
  queue: { name: string; ttl: number; joined: number; note?: string }[];
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

export interface ChannelState {
  members: Map<string, Member>;
  tasks: Map<number, Task>;
  facts: Map<string, Fact>;
  leases: Map<string, Lease>;
  trust: Map<number, Trust>;
  rejected: Map<number, string>;
  scopeSets: Map<string, { seq: number; scopes: Scope[]; persona?: Persona | null }>;
  roleSets: Map<string, { seq: number; role: string | null; about?: string | null }>;
  openAsks: Message[];
  askHeads: Map<number, AskHead>;
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
  compact: Compact | null;
  compactProposal: Compact | null;
  reactions: Map<number, Map<string, Reaction>>;
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
}

export interface SecretRoom {
  n: number;
  seals: RoomSeal[];
  meta?: RoomMeta;
}

export type PersonaLead = boolean | "roster";

export interface FoldBase {
  n: number;
  members: { name: string; role?: string; about?: string; color?: Color; picture?: MemberPicture; card?: Card & { at: number }; lastSeen: number; messages: number; ops?: Record<string, number> }[];
  lead: string | null;
  charter: Charter | null;
  repos?: string[];
  github?: { prs: GithubPr[]; checks: [string, GithubCheck[]][]; issues?: GithubIssue[]; rules?: GithubRules[]; releases?: GithubRelease[] };
  hold: Hold | null;
  voice?: boolean;
  githubWrite?: number | null;
  branchPrefix?: string | null;
  compact: Compact | null;
  compactProposal: Compact | null;
  scopesByKey: [string, Scope[]][];
  scopeSets: [string, { seq: number; scopes: Scope[]; persona?: Persona | null }][];
  roleSets: [string, { seq: number; role: string | null; about?: string | null }][];
  tasks: Task[];
  facts: Fact[];
  leases: Lease[];
  reactions: [number, [string, Reaction][]][];
  reactSeqs: number[];
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

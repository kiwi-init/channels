import type { DeviceLink } from "@kiwi/core/devices.ts";
import type { ChannelIdentityView, PersonView, PublicPerson } from "../../desktop/src/bridge.ts";

export interface Saved {
  relay: string;
  person: PersonView | null;
  seats: ChannelIdentityView[];
  device?: EnrolledPhone | null;
}

interface EnrolledPhone {
  key: PersonView;
  links: DeviceLink[];
  person: PublicPerson;
}

export interface EnrollStart {
  url: string | null;
  code: string;
}

export type Ask =
  | { op: "start"; saved: Saved; kept?: Record<string, unknown> }
  | { op: "enrollBegin"; relay: string; label: string; os: string; user?: string; waitMs?: number }
  | { op: "enrollAsk" }
  | { op: "enrollWait" }
  | { op: "enrollCheck" }
  | { op: "enrollFinish" }
  | { op: "enrollCancel" }
  | { op: "send"; code: string; body: string; re: number | null; imgs: Picture[]; place?: string }
  | { op: "image"; code: string; seq: number; index: number }
  | { op: "answer"; code: string; seq: number; text: string }
  | { op: "react"; code: string; seq: number; emoji: string | null }
  | { op: "approve"; code: string; task: number }
  | { op: "sendBack"; code: string; task: number; why: string }
  | { op: "allow"; code: string; id: string; allow: boolean }
  | { op: "letIn"; code: string; id: string }
  | { op: "approveSpec"; code: string; ask: number; v: number }
  | { op: "open"; code: string; place: string }
  | { op: "marks"; code: string; marks: Record<string, number>; write: boolean }
  | { op: "nudge" }
  | { op: "push"; token: string; sandbox: boolean };

export interface Picture {
  name: string;
  mime: string;
  data: string;
}

export type Reply = { ok: true; value: unknown } | { ok: false; error: string };

export type Fetched = { id: number; status: number; body: string } | { id: number; error: string };

export type Push =
  | { type: "saved"; saved: Saved }
  | { type: "room"; room: RoomView }
  | { type: "gone"; code: string }
  | { type: "log"; line: string }
  | { type: "removed"; by: string }
  | { type: "kept"; code: string; sealed: unknown }
  | { type: "fetch"; id: number; url: string; body: string };

export type Connection = "connecting" | "live" | "reconnecting";

export interface MemberView {
  name: string;
  display: string;
  kind: "human" | "agent" | "computer";
  role: string | null;
  face: string | null;
  owner: boolean;
  lead: boolean;
  color: string | null;
  here: boolean;
  activity: { state: "working" | "waiting" | "idle"; tool: string | null; since: number | null } | null;
  sponsor: string | null;
  model: string | null;
  harness: string | null;
  mono: boolean;
  doing: number[];
}

interface QuoteView {
  seq: number;
  from: string;
  words: string;
}

export interface MessageView {
  seq: number;
  from: string;
  at: number;
  kind: string;
  body: string;
  shown: string;
  plain: string;
  event: boolean;
  mine: boolean;
  quote: QuoteView | null;
  choices: string[];
  chosen: { choice: string; by: string } | null;
  waiting: boolean;
  images: number;
  task: number | null;
  reactions: ReactionView[];
}

interface ReactionView {
  emoji: string;
  who: string[];
  mine: boolean;
}

export interface TaskView {
  id: number;
  title: string;
  state: "todo" | "doing" | "review" | "done";
  owner: string | null;
  review: string | null;
  updatedAt: number;
  createdAt: number;
  last: string | null;
  archived: boolean;
}

export interface AskView {
  seq: number;
  from: string;
  body: string;
  shown: string;
  plain: string;
  at: number;
  label: string;
  choices: string[];
  task: number | null;
  place: string;
}

export interface ReviewView {
  task: number;
  title: string;
  by: string | null;
  at: number;
}

export type NeedView =
  | {
      kind: "permission";
      id: string;
      from: string;
      at: number;
      title: string;
      summary: string | null;
      code: string;
      cwd: string | null;
      canAllow: boolean;
      allower: string | null;
      expiresAt: number | null;
      task: number | null;
    }
  | {
      kind: "join";
      id: string;
      at: number;
      name: string;
      who: "human" | "agent";
      runs: string | null;
      machine: string | null;
      sponsor: string | null;
      code: string;
      pinned: boolean;
    }
  | { kind: "spec"; id: string; at: number; ask: number; v: number; changed: boolean; title: string; text: string; by: string };

export interface PlaceView {
  key: string;
  kind: "main" | "dm" | "task";
  title: string;
  with: string[];
  withMe: boolean;
  task: number | null;
  lastSeq: number;
  last: MessageView | null;
  count: number;
  done: boolean;
}

export type IconView = { kind: "robot"; robot: string } | { kind: "emoji"; emoji: string } | { kind: "image"; mime: string; data: string };

export interface RoomView {
  code: string;
  title: string;
  icon: IconView;
  me: string;
  isOwner: boolean;
  connection: Connection;
  gone: "removed" | "closed" | null;
  error: string | null;
  head: number;
  whole: boolean;
  hold: string | null;
  charter: string | null;
  lead: string | null;
  members: MemberView[];
  messages: MessageView[];
  side: MessageView[];
  sideKey: string | null;
  tasks: TaskView[];
  asks: AskView[];
  reviews: ReviewView[];
  needs: NeedView[];
  last: MessageView | null;
  latest: MessageView | null;
  latestIn: string;
  place: string;
  places: PlaceView[];
}

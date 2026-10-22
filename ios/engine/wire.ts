import type { ChannelIdentityView, PersonView } from "../../desktop/src/bridge.ts";

export interface Saved {
  relay: string;
  person: PersonView | null;
  seats: ChannelIdentityView[];
}

export type Ask =
  | { op: "start"; saved: Saved }
  | { op: "linkAsk"; code: string; label: string }
  | { op: "linkWait" }
  | { op: "linkCancel" }
  | { op: "send"; code: string; body: string; re: number | null; imgs: Picture[] }
  | { op: "image"; code: string; seq: number; index: number }
  | { op: "answer"; code: string; seq: number; text: string }
  | { op: "react"; code: string; seq: number; emoji: string | null }
  | { op: "open"; code: string; place: string }
  | { op: "nudge" };

export interface Picture {
  name: string;
  mime: string;
  data: string;
}

export type Reply = { ok: true; value: unknown } | { ok: false; error: string };

export type Push = { type: "saved"; saved: Saved } | { type: "room"; room: RoomView } | { type: "gone"; code: string } | { type: "log"; line: string };

export type Connection = "connecting" | "live" | "reconnecting";

export interface MemberView {
  name: string;
  display: string;
  kind: "human" | "agent" | "computer";
  role: string | null;
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
  at: number;
  label: string;
  choices: string[];
  task: number | null;
}

export interface PlaceView {
  key: string;
  kind: "main" | "dm" | "task";
  title: string;
  with: string[];
  withMe: boolean;
  task: number | null;
  lastSeq: number;
  last: MessageView | null;
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
  tasks: TaskView[];
  asks: AskView[];
  last: MessageView | null;
  place: string;
  places: PlaceView[];
}

import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { LaunchChoices } from "@kiwi/core/launch-options.ts";
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
  | { op: "start"; saved: Saved }
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
  | { op: "open"; code: string; place: string }
  | { op: "nudge" }
  | { op: "computers" }
  | { op: "harnessesOn"; computer: string }
  | { op: "foldersOn"; computer: string; code: string }
  | LaunchAsk;

export type HarnessChoice = HarnessRow & { name: string; face: string; mono: boolean };

export type LaunchAsk = { op: "launch"; code: string; computer: string; harness: string; folder: string; nick?: string } & LaunchChoices;

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
  | { type: "fetch"; id: number; url: string; body: string }
  | { type: "launch"; code: string; launch: string; stage: "asked" | "joined"; name: string };

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
  side: MessageView[];
  sideKey: string | null;
  tasks: TaskView[];
  asks: AskView[];
  reviews: ReviewView[];
  last: MessageView | null;
  latest: MessageView | null;
  latestIn: string;
  place: string;
  places: PlaceView[];
}

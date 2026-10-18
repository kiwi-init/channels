import type { Socket, Subprocess } from "bun";
import type { Channel, Info, MemberRow, Probe } from "@kiwi/core/client.ts";
import type { Activity, Reach } from "@kiwi/core/protocol.ts";
import type { WakeVia } from "@kiwi/core/wake.ts";
import type { DaemonListener, DaemonWake } from "./protocol.ts";

export interface Seat {
  key: string;
  alias: string;
  agent: string;
  ch: Channel;
  ctl: AbortController;
  subs: Set<Sub>;
  head: number;
  activity: Activity | undefined;
  reach: Reach | null;
  activityTimer: ReturnType<typeof setInterval> | null;
  announce: (() => void) | null;
  beacon: ReturnType<typeof setInterval> | null;
  lastProbe: number;
  mark: ((seq: number) => boolean) | null;
  marked: number;
  wantMark: number;
  lastMarkAt: number;
  markTimer: ReturnType<typeof setTimeout> | null;
  wakeVia: WakeVia | null;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  waking: boolean;
  wakeAgain: boolean;
  wakeChild: Subprocess | null;
  lastWake: DaemonWake | null;
  probe: ((ms: number) => Promise<Probe | null>) | null;
  rows: SeatRows | null;
  fetchingRows: boolean;
}

interface SeatRows {
  probe: (ms: number) => Promise<Probe | null>;
  changes: number;
  members: MemberRow[];
  info: Info;
}

export const readKey = (alias: string, agent: string): string => `${alias}\u0000${agent}`;

export interface Sub {
  id: number;
  cursor: number;
  conn: ConnState;
  seat: Seat;
}

export interface Waiting {
  tell: (status: string) => void;
  alive: () => boolean;
}

export interface ConnState {
  socket: Socket;
  decoder: TextDecoder;
  buf: string;
  subs: Set<Sub>;
  held: Set<DaemonListener>;
  dead: boolean;
  out: Uint8Array[];
  queued: number;
}

import type { Message } from "@kiwi/core/protocol.ts";
import type { GuardFloor, Roster, RoomsFloor } from "@kiwi/core/state.ts";

export interface FoldInputs {
  roster: Roster;
  roomsFloor: RoomsFloor | null;
  guardFloor: GuardFloor | null;
  now: number;
}

export interface IndexHit {
  seq: number;
  rank: number;
}

export interface Searched {
  state: "ready" | "indexing";
  hits: IndexHit[];
  through: number;
}

export interface SearchCalls {
  open: { args: { file: string; key: string; roomId: string }; value: { through: number } };
  feed: { args: { messages: Message[]; inputs: FoldInputs }; value: { through: number } };
  search: { args: { query: string; rooms: string[]; limit: number }; value: { hits: IndexHit[]; through: number } };
  dropRoom: { args: { room: string }; value: { through: number } };
  forget: { args: Record<never, never>; value: null };
  unload: { args: Record<never, never>; value: null };
}

export type SearchOp = keyof SearchCalls;

export type SearchAsk = { [K in SearchOp]: { id: number; op: K; code: string } & SearchCalls[K]["args"] }[SearchOp];

export type SearchReply = { id: number; ok: true; value: SearchCalls[SearchOp]["value"] } | { id: number; ok: false; error: string };

import { verifyRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { readDeviceList, speaksForPerson } from "@kiwi/core/devices.ts";
import { accountScope } from "@kiwi/core/enroll.ts";
import { BadRequest, Conflict, Forbidden, SignInRequired, TooLarge, Unauthorized } from "./failures.ts";
import { readCapped } from "./http.ts";
import type { HumanAuth } from "./human.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { errorResponse } from "./room/http.ts";
import { requestToken } from "./room/auth.ts";
import type { AccountStore } from "./account.ts";

export const MOVE_PATH = "/v1/account/move";
export const MOVE_TO_HEADER = "x-human-token-to";
export const FREEZE_MS = 10 * 60_000;
const MOVE_MAX_BYTES = 1024;

export type Row = Record<string, string | number | null>;
export type Rows = Record<string, Row[]>;

export interface Freeze {
  to: string;
  id: string;
  at: number;
}

export type MoveState = { frozen: Freeze } | { moved: string } | null;

export type Adoption = "adopted" | "taken" | "abandoned";

export interface MoveStore {
  state(from: string): Promise<MoveState>;
  freeze(from: string, next: Freeze): Promise<boolean>;
  thaw(from: string, id: string): Promise<void>;
  settle(from: string, to: string, id: string): Promise<void>;
  rows(from: string): Promise<Rows>;
  busy(from: string, now: number): Promise<"asking" | null>;
  holds(to: string): Promise<boolean>;
  adopt(to: string, from: string, id: string, rows: Rows): Promise<Adoption>;
  abandon(to: string, from: string, id: string): Promise<Exclude<Adoption, "taken">>;
  rooms(from: string): Promise<string[]>;
  reown(room: string, from: string, to: string): Promise<void>;
}

export const TAKEN = "this GitHub account already has devices of its own, so nothing was moved: sign in with the GitHub account you use with Channels";

const refuse = (err: unknown): Response => withCors(errorResponse(err));

async function settled(store: MoveStore, from: string, freeze: Freeze): Promise<MoveState> {
  if ((await store.abandon(freeze.to, from, freeze.id)) === "adopted") {
    await store.settle(from, freeze.to, freeze.id);
    return { moved: freeze.to };
  }
  await store.thaw(from, freeze.id);
  return null;
}

async function current(store: MoveStore, from: string, now: number): Promise<MoveState> {
  const state = await store.state(from);
  if (state && "frozen" in state && state.frozen.at + FREEZE_MS <= now) return settled(store, from, state.frozen);
  return state;
}

export async function accountHome(store: MoveStore, user: string, now: number): Promise<{ user: string; frozen: boolean }> {
  const state = await current(store, user, now);
  if (state && "moved" in state) return { user: state.moved, frozen: false };
  return { user, frozen: state !== null };
}

export function movedHuman(human: HumanAuth | null, movedTo: (user: string) => Promise<string | null>): HumanAuth | null {
  if (!human) return null;
  return {
    ...human,
    verify: async (token) => {
      const user = await human.verify(token);
      return user && !user.startsWith("github_") ? ((await movedTo(user)) ?? user) : user;
    },
  };
}

export function frozenWrite(req: Request): Response | null {
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return null;
  return refuse(new Conflict({ message: "this account is moving to your GitHub sign-in; try again in a moment" }));
}

export async function moveUsers(req: Request, human: HumanAuth | null, from: string): Promise<string | Response> {
  if (!human?.github) return refuse(new BadRequest({ message: "this relay takes no GitHub sign-in, so there's nowhere to move an account to" }));
  const to = await human.verify(req.headers.get(MOVE_TO_HEADER) ?? "");
  if (!to?.startsWith("github_")) return refuse(new SignInRequired({ message: "sign in with GitHub to move your account to it" }));
  if (from.startsWith("github_")) return refuse(new BadRequest({ message: "this account is already a GitHub one" }));
  return to;
}

export async function onMoveHttp(req: Request, store: MoveStore, accounts: AccountStore, from: string, to: string, now: number): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return refuse(new BadRequest({ message: "a move is a POST" }));
  const bytes = await readCapped(req, MOVE_MAX_BYTES);
  if (bytes === null) return refuse(new TooLarge({ message: "that request is too large for a move" }));
  const body = new TextDecoder().decode(bytes);
  if (parseTo(body) !== to) return refuse(new BadRequest({ message: "a move takes {to}: the GitHub account it goes to, the one signed in" }));
  const signer = await verifyRequest(requestToken(req), accountScope(from), "POST", MOVE_PATH, body, now);
  if (!signer) return refuse(new Unauthorized({ message: "sign this move for the account it moves" }));
  const links = await accounts.links(from);
  if (links.length) {
    const read = await readDeviceList(links);
    if (!read.ok) throw new Error(`a kept device list doesn't hold up: ${read.why}`);
    if (read.list.revoked.includes(signer) || !speaksForPerson(read.list, signer, now))
      return refuse(new Forbidden({ message: "only the person key or an app that approves devices moves this account" }));
  }

  const state = await current(store, from, now);
  if (state && "moved" in state) {
    if (state.moved !== to) return refuse(new Conflict({ message: "this account already moved to another GitHub account" }));
  } else {
    let freeze = state?.frozen ?? null;
    if (freeze && freeze.to !== to) return refuse(new Conflict({ message: "this account is moving to another GitHub account; try again in 10 minutes" }));
    if (!freeze) {
      if ((await store.busy(from, now)) === "asking") return refuse(new Conflict({ message: "a device is asking to join this account: approve it or turn it away, then move" }));
      if (await store.holds(to)) return refuse(new Conflict({ message: TAKEN }));
      freeze = { to, id: b64url(crypto.getRandomValues(new Uint8Array(16))), at: now };
      if (!(await store.freeze(from, freeze))) return refuse(new Conflict({ message: "the account changed meanwhile; try again" }));
    }
    const got = await store.adopt(to, from, freeze.id, await store.rows(from));
    if (got === "taken") {
      await store.thaw(from, freeze.id);
      return refuse(new Conflict({ message: TAKEN }));
    }
    if (got === "abandoned") return refuse(new Conflict({ message: "that move ran out of time; try again" }));
    await store.settle(from, to, freeze.id);
  }

  const rooms = await store.rooms(from);
  for (const room of rooms) await store.reown(room, from, to);
  return withCors(Response.json({ user: to, rooms: rooms.length }));
}

function parseTo(text: string): string | null {
  try {
    const v = JSON.parse(text) as { to?: unknown } | null;
    return v && typeof v.to === "string" ? v.to : null;
  } catch {
    // Not JSON: the move is refused as a bad request.
    return null;
  }
}

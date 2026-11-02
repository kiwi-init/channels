import * as Effect from "effect/Effect";
import { verifyRequest } from "@kiwi/core/auth.ts";
import { GONE_WORDS, WS_PROTOCOL, type GoneHow } from "@kiwi/core/protocol.ts";
import { ChannelGone, NotMember, Unauthorized, UpdateRequired } from "../failures.ts";
import { RoomStore, type RoomDb } from "./db.ts";

export const UPDATE_KIWI = "update kiwi to join or approve here: curl -fsSL https://channels.kiwiinit.com/install | sh";

export function missingFingerprint(method: string, path: string, url: URL): UpdateRequired | null {
  const m = method.toUpperCase();
  if (((m === "GET" && path === "/info") || (m === "POST" && path === "/requests")) && url.searchParams.get("fp") === null) {
    return new UpdateRequired({ message: UPDATE_KIWI });
  }
  return null;
}

export function requestToken(req: Request): string {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const protos = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
  if (protos[0] === WS_PROTOCOL && protos[1]) return protos[1];
  return "";
}

export function wsHeaders(req: Request): Record<string, string> {
  return req.headers.get("sec-websocket-protocol")?.includes(WS_PROTOCOL) ? { "sec-websocket-protocol": WS_PROTOCOL } : {};
}

interface Meta {
  ownerPk: string;
  ownerXpk: string;
  ownerSig: string;
  epoch: number;
  rotate: boolean;
}

export const gone = () => new ChannelGone({ message: "no such channel" });

export const readMeta = Effect.gen(function* () {
  const db = yield* RoomStore;
  if (!db.exists()) return yield* gone();
  const m: Meta = {
    ownerPk: db.get("owner_pk")!,
    ownerXpk: db.get("owner_xpk")!,
    ownerSig: db.get("owner_sig")!,
    epoch: Number(db.get("epoch") ?? 0),
    rotate: db.get("rotate") === "1",
  };
  return m;
});

function goneOf(db: RoomDb, pk: string): GoneHow | null {
  db.migrate();
  const how = db.sql.all<{ gone: string | null }>("SELECT gone FROM members WHERE pk = ? AND active = 0", pk)[0]?.gone;
  return how === "owner" || how === "left" ? how : null;
}

export const authenticate = Effect.fn("Room.authenticate")(function* (req: Request, method: string, path: string, body: string, olderPath?: string) {
  const db = yield* RoomStore;
  const token = requestToken(req);
  let pk = yield* Effect.promise(() => verifyRequest(token, db.roomId, method, path, body));
  if (!pk && olderPath !== undefined) pk = yield* Effect.promise(() => verifyRequest(token, db.roomId, method, olderPath, body));
  if (!pk) return yield* new Unauthorized({ message: "bad or expired signature" });
  if (!db.exists()) return yield* gone();
  if (!db.isMember(pk)) {
    const how = goneOf(db, pk);
    return yield* how ? new NotMember({ message: `not a member of this channel: ${GONE_WORDS[how]}` }) : gone();
  }
  return pk;
});

export const authenticateSocket = (req: Request) => authenticate(req, "GET", "/ws" + new URL(req.url).search, "", "/ws");

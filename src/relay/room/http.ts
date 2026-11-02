import { verifyRequest } from "@kiwi/core/auth.ts";
import { isRefusal, refusalResponse, Unauthorized } from "../failures.ts";
import type { HumanAuth } from "../human.ts";
import { MAX_REQUEST_BYTES, readText } from "../http.ts";
import { requestToken } from "./auth.ts";

export function errorResponse(err: unknown): Response {
  if (isRefusal(err)) return refusalResponse(err);
  console.error(err instanceof Error ? err.message : "error");
  return Response.json({ error: "internal error" }, { status: 500 });
}

export function parseRoomPath(pathname: string): { roomId: string; rest: string } | null {
  const m = /^\/v1\/rooms\/([0-9a-f]{32})(\/.*)?$/.exec(pathname);
  return m ? { roomId: m[1]!, rest: m[2] ?? "/" } : null;
}

export interface RoomGate {
  signer: string | null;
  open: boolean;
}

const refused = () => errorResponse(new Unauthorized({ message: "bad or expired signature" }));

export async function gateRoom(req: Request, roomId: string, rest: string, now = Date.now()): Promise<RoomGate | Response> {
  const url = new URL(req.url);
  const token = requestToken(req);
  const method = req.method.toUpperCase();
  const open = (method === "GET" && rest === "/info") || (method === "POST" && rest === "/requests");
  if (!token) return open ? { signer: null, open: true } : refused();
  if (rest === "/ws") {
    let signer = await verifyRequest(token, roomId, "GET", "/ws" + url.search, "", now);
    if (!signer && url.search) signer = await verifyRequest(token, roomId, "GET", "/ws", "", now);
    return signer ? { signer, open: false } : refused();
  }
  let body = "";
  if (method !== "GET" && method !== "HEAD" && !(method === "PUT" && rest.startsWith("/blobs/"))) {
    const read = await readText(req.clone().body, MAX_REQUEST_BYTES, req.headers.get("content-length"));
    if (read === null) return Response.json({ error: "request too large", tag: "TooLarge" }, { status: 413 });
    body = read;
  }
  const signer = await verifyRequest(token, roomId, method, rest + url.search, body, now);
  return signer ? { signer, open } : refused();
}

export function relayConfig(human: HumanAuth | null, githubClientId?: string | null): Response {
  return Response.json({
    workosClientId: human?.clientId ?? null,
    ...(human?.dev ? { dev: true } : {}),
    ...(githubClientId ? { githubClientId } : {}),
    ...(human?.github ? { githubSignIn: true } : {}),
  });
}

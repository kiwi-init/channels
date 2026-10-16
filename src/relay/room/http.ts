import { isRefusal, refusalResponse } from "../failures.ts";
import type { HumanAuth } from "../human.ts";

export function errorResponse(err: unknown): Response {
  if (isRefusal(err)) return refusalResponse(err);
  console.error(err instanceof Error ? err.message : "error");
  return Response.json({ error: "internal error" }, { status: 500 });
}

export function parseRoomPath(pathname: string): { roomId: string; rest: string } | null {
  const m = /^\/v1\/rooms\/([0-9a-f]{32})(\/.*)?$/.exec(pathname);
  return m ? { roomId: m[1]!, rest: m[2] ?? "/" } : null;
}

export function relayConfig(human: HumanAuth | null): Response {
  return Response.json({ workosClientId: human?.clientId ?? null, ...(human?.dev ? { dev: true } : {}) });
}

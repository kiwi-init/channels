import { b64url } from "./crypto.ts";

export async function sessionFingerprint(roomId: string, session: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kiwi-session:${roomId}:${session}`)));
  return b64url(digest.slice(0, 12));
}

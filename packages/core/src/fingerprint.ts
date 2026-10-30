import { fromB64url } from "./crypto.ts";

export async function personFingerprint(pk: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fromB64url(pk)));
  const hex = [...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [0, 4, 8, 12, 16].map((at) => hex.slice(at, at + 4)).join(" ");
}

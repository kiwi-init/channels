import { b64url, openWith, sealWith } from "./crypto.ts";
import { sign, verify, type Identity } from "./identity.ts";

export const NOTE_MAX_BYTES = 64 * 1024;
export const NOTES_PER_KEY = 4;
export const NOTE_IDLE_MS = 90 * 86_400_000;
const MAX_PLACES = 2_000;

export type Marks = Readonly<Record<string, number>>;

const enc = new TextEncoder();
const ad = (roomId: string, id: string) => `kiwi-note\n${roomId}\n${id}`;

export async function noteId(roomId: string, key: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`kiwi-note-id\n${roomId}\n${key}`))));
}

export function mergeMarks(a: Marks, b: Marks): Marks {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) if (!(k in out) || (out[k] ?? 0) < v) out[k] = v;
  return out;
}

const cleanMarks = (x: unknown): Marks | null => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const entries = Object.entries(x as Record<string, unknown>);
  if (entries.length > MAX_PLACES) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (k.length > 200 || !Number.isSafeInteger(v) || (v as number) < 0) return null;
    out[k] = v as number;
  }
  return out;
};

export async function sealNote(key: string, roomId: string, id: string, writer: Identity, marks: Marks): Promise<string> {
  const signed = await sign(writer, { marks, at: Date.now() });
  return sealWith(key, JSON.stringify(signed), ad(roomId, id));
}

export async function openNote(key: string, roomId: string, id: string, box: string): Promise<{ marks: Marks; pk: string } | null> {
  const text = await openWith(key, box, ad(roomId, id));
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A box that opens but isn't JSON is someone else's garbage: read it as no note.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as { marks?: unknown; pk?: unknown };
  const marks = cleanMarks(p.marks);
  if (!marks || typeof p.pk !== "string" || !(await verify(parsed))) return null;
  return { marks, pk: p.pk };
}

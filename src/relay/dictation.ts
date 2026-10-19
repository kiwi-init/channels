import { dictationFile, DICTATION_PATH, sha256Hex, type DictationFile } from "@kiwi/core/dictation.ts";
import { withCors } from "./mailbox.ts";

export interface DictationStore {
  read(sha256: string): Promise<Uint8Array<ArrayBuffer> | null>;
  write(sha256: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

export interface DictationDeps {
  store: DictationStore;
  ip: string | null;
  allow: (ip: string) => boolean | Promise<boolean>;
  upstream?: (url: string) => Promise<Response>;
  lookup?: (name: string) => DictationFile | null;
}

export const DICTATION_UNREACHABLE = "This relay can't fetch the dictation model right now.";
export const DICTATION_TAMPERED = "The dictation model's source sent a file that doesn't match its pinned hash.";
export const DICTATION_TOO_MANY = "Too many dictation downloads from this address. Try again in a minute.";

function said(status: number, message: string): Response {
  return withCors(new Response(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }));
}

function served(req: Request, bytes: Uint8Array<ArrayBuffer>): Response {
  const headers = { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength), "cache-control": "no-store" };
  return withCors(new Response(req.method === "HEAD" ? null : bytes, { headers }));
}

export async function onDictationHttp(req: Request, deps: DictationDeps): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(DICTATION_PATH)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return said(405, "Method not allowed.");
  const file = url.search ? null : (deps.lookup ?? dictationFile)(url.pathname.slice(DICTATION_PATH.length));
  if (!file) return said(404, "Not found.");
  if (deps.ip && !(await deps.allow(deps.ip))) return said(429, DICTATION_TOO_MANY);
  const kept = await deps.store.read(file.sha256);
  if (kept) return served(req, kept);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const res = await (deps.upstream ?? ((u: string) => fetch(u)))(file.url);
    if (!res.ok) return said(502, DICTATION_UNREACHABLE);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    // Upstream unreachable (a self-hosted relay offline, a Hugging Face outage): the app says dictation isn't available.
    return said(502, DICTATION_UNREACHABLE);
  }
  if (bytes.byteLength !== file.size || (await sha256Hex(bytes)) !== file.sha256) return said(502, DICTATION_TAMPERED);
  await deps.store.write(file.sha256, bytes);
  return served(req, bytes);
}

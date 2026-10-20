import { dictationFile, DICTATION_PATH, type DictationFile, type Hasher } from "@kiwi/core/dictation.ts";
import { withCors } from "./mailbox.ts";

export interface DictationStore {
  read(sha256: string): Promise<ReadableStream<Uint8Array> | Blob | null>;
  write(sha256: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>;
}

export interface DictationDeps {
  store: DictationStore | null;
  hasher: () => Hasher;
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

function served(req: Request, body: ReadableStream<Uint8Array> | Blob, size: number): Response {
  const headers = { "content-type": "application/octet-stream", "content-length": String(size), "cache-control": "no-store" };
  if (req.method === "HEAD" && body instanceof ReadableStream) void body.cancel();
  return withCors(new Response(req.method === "HEAD" ? null : body, { headers }));
}

export async function onDictationHttp(req: Request, deps: DictationDeps): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(DICTATION_PATH)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return said(405, "Method not allowed.");
  const file = url.search ? null : (deps.lookup ?? dictationFile)(url.pathname.slice(DICTATION_PATH.length));
  if (!file) return said(404, "Not found.");
  if (deps.ip && !(await deps.allow(deps.ip))) return said(429, DICTATION_TOO_MANY);
  const kept = await deps.store?.read(file.sha256);
  if (kept) return served(req, kept, file.size);
  const fetched = await fetchChecked(file, deps);
  if (fetched instanceof Response) return fetched;
  if (!deps.store) return served(req, fetched.body, file.size);
  try {
    await deps.store.write(file.sha256, fetched.body, file.size);
  } catch {
    // The upstream stream broke off or failed its pinned hash partway: the store kept nothing, and the app says dictation isn't available.
    return said(502, fetched.tampered() ? DICTATION_TAMPERED : DICTATION_UNREACHABLE);
  }
  const stored = await deps.store.read(file.sha256);
  if (stored) return served(req, stored, file.size);
  const again = await fetchChecked(file, deps);
  return again instanceof Response ? again : served(req, again.body, file.size);
}

async function fetchChecked(file: DictationFile, deps: DictationDeps): Promise<Response | { body: ReadableStream<Uint8Array>; tampered: () => boolean }> {
  let res: Response;
  try {
    res = await (deps.upstream ?? ((u: string) => fetch(u)))(file.url);
  } catch {
    // Upstream unreachable (a self-hosted relay offline, a Hugging Face outage): the app says dictation isn't available.
    return said(502, DICTATION_UNREACHABLE);
  }
  if (!res.ok || !res.body) return said(502, DICTATION_UNREACHABLE);
  const length = res.headers.get("content-length");
  if (length !== null && Number(length) !== file.size) {
    void res.body.cancel();
    return said(502, DICTATION_TAMPERED);
  }
  let tampered = false;
  const hasher = deps.hasher();
  let seen = 0;
  let held: Uint8Array | null = null;
  const refuse = () => {
    tampered = true;
    return new Error(DICTATION_TAMPERED);
  };
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, out) {
        seen += chunk.byteLength;
        if (seen > file.size) throw refuse();
        await hasher.update(chunk);
        if (held) out.enqueue(held);
        held = chunk;
      },
      async flush(out) {
        if (seen !== file.size || (await hasher.hex()) !== file.sha256) throw refuse();
        if (held) out.enqueue(held);
      },
    }),
  );
  return { body, tampered: () => tampered };
}

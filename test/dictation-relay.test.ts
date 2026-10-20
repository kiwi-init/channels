import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DICTATION_BYTES, DICTATION_FILES, dictationFile, sha256Hex, type DictationFile } from "@kiwi/core/dictation.ts";
import { downloadAllowed } from "../src/relay/address.ts";
import { bunHasher, startRelay } from "../src/relay/bun.ts";
import { DICTATION_TAMPERED, DICTATION_TOO_MANY, DICTATION_UNREACHABLE, onDictationHttp, type DictationStore } from "../src/relay/dictation.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const bytes = new TextEncoder().encode('{"model":"tiny test"}');
const name = "whisper-base/config.json";

async function fakeFile(): Promise<DictationFile> {
  return { url: "https://upstream.invalid/config.json", sha256: await sha256Hex(bytes), size: bytes.byteLength };
}

function memoryStore(): DictationStore & { kept: Map<string, Uint8Array<ArrayBuffer>> } {
  const kept = new Map<string, Uint8Array<ArrayBuffer>>();
  return { kept, read: async (sha) => (kept.has(sha) ? new Blob([kept.get(sha)!]) : null), write: async (sha, body) => void kept.set(sha, new Uint8Array(await new Response(body).arrayBuffer())) };
}

const get = (path: string, method = "GET") => new Request(`https://relay.test${path}`, { method });

function chunked(data: Uint8Array, size: number, pulled: { n: number } = { n: 0 }): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (at >= data.byteLength) return c.close();
        pulled.n += 1;
        c.enqueue(data.slice(at, at + size));
        at += size;
      },
    },
    { highWaterMark: 0 },
  );
}

async function fileOf(data: Uint8Array<ArrayBuffer>): Promise<DictationFile> {
  return { url: "https://upstream.invalid/model.onnx", sha256: await sha256Hex(data), size: data.byteLength };
}

describe("the relay's dictation route", () => {
  test("serves an allowlisted file it fetched and verified, keeps it, and serves the kept copy next time", async () => {
    const file = await fakeFile();
    const store = memoryStore();
    let upstreamCalls = 0;
    const deps = {
      store,
      hasher: bunHasher,
      ip: "203.0.113.1",
      allow: () => true,
      lookup: (n: string) => (n === name ? file : null),
      upstream: async (url: string) => {
        upstreamCalls += 1;
        expect(url).toBe(file.url);
        return new Response(bytes);
      },
    };
    const first = await onDictationHttp(get(`/v1/dictation/${name}`), deps);
    expect(first?.status).toBe(200);
    expect(first?.headers.get("cache-control")).toBe("no-store");
    expect(first?.headers.get("access-control-allow-origin")).toBe("*");
    expect(new Uint8Array(await first!.arrayBuffer())).toEqual(bytes);
    expect(store.kept.has(file.sha256)).toBe(true);
    const again = await onDictationHttp(get(`/v1/dictation/${name}`), deps);
    expect(new Uint8Array(await again!.arrayBuffer())).toEqual(bytes);
    expect(upstreamCalls).toBe(1);
    const head = await onDictationHttp(get(`/v1/dictation/${name}`, "HEAD"), deps);
    expect(head?.status).toBe(200);
    expect(head?.headers.get("content-length")).toBe(String(bytes.byteLength));
  });

  test("a kept file is streamed as it is, never read whole into memory first", async () => {
    const file = await fakeFile();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        c.enqueue(bytes);
        c.close();
      },
    });
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store: { read: async () => stream, write: async () => undefined },
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => Promise.reject(new Error("a hit never goes upstream")),
    });
    expect(pulls).toBeLessThanOrEqual(1);
    expect(res?.body).toBe(stream);
    expect(res?.headers.get("content-length")).toBe(String(file.size));
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(bytes);
  });

  test("a file that doesn't match its pinned hash or size is refused and never kept", async () => {
    const file = await fakeFile();
    for (const sent of [new TextEncoder().encode('{"model":"evil test"}'), bytes.slice(1)]) {
      const store = memoryStore();
      const res = await onDictationHttp(get(`/v1/dictation/${name}`), { store, hasher: bunHasher, ip: null, allow: () => true, lookup: () => file, upstream: async () => new Response(sent) });
      expect(res?.status).toBe(502);
      expect(await res!.text()).toBe(`${DICTATION_TAMPERED}\n`);
      expect(store.kept.size).toBe(0);
    }
  });

  test("a big file streams from upstream through the hash into the store, a few chunks ahead at most, never held whole", async () => {
    const data = crypto.getRandomValues(new Uint8Array(1 << 20));
    const file = await fileOf(data);
    const pulled = { n: 0 };
    let ahead = 0;
    const kept: Uint8Array[] = [];
    const store: DictationStore = {
      read: async (sha) => (kept.length && sha === file.sha256 ? new Blob(kept) : null),
      write: async (_sha, body) => {
        const parts: Uint8Array[] = [];
        let read = 0;
        for await (const chunk of body) {
          read += 1;
          ahead = Math.max(ahead, pulled.n - read);
          parts.push(chunk);
        }
        kept.push(...parts);
      },
    };
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store,
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => new Response(chunked(data, 16_384, pulled)),
    });
    expect(res?.status).toBe(200);
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(data);
    expect(pulled.n).toBe(64);
    expect(ahead).toBeLessThanOrEqual(4);
  });

  test("a file swapped for another of the same size is refused at its end, and the store never sees its last bytes", async () => {
    const data = crypto.getRandomValues(new Uint8Array(100_000));
    const file = await fileOf(data);
    const evil = data.slice();
    evil[50_000] = evil[50_000]! ^ 1;
    let got = 0;
    const store: DictationStore = {
      read: async () => null,
      write: async (_sha, body) => {
        for await (const chunk of body) got += chunk.byteLength;
      },
    };
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store,
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => new Response(chunked(evil, 8_192)),
    });
    expect(res?.status).toBe(502);
    expect(await res!.text()).toBe(`${DICTATION_TAMPERED}\n`);
    expect(got).toBeLessThan(file.size);
  });

  test("an upstream that says the wrong length is refused before anything is read", async () => {
    const file = await fakeFile();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull: () => void (pulls += 1) }, { highWaterMark: 0 });
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store: memoryStore(),
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => new Response(body, { headers: { "content-length": String(file.size + 1) } }),
    });
    expect(res?.status).toBe(502);
    expect(await res!.text()).toBe(`${DICTATION_TAMPERED}\n`);
    expect(pulls).toBe(0);
  });

  test("with no store (a Worker on workers.dev) the verified stream goes straight to the app, and a swapped file never completes", async () => {
    const data = crypto.getRandomValues(new Uint8Array(50_000));
    const file = await fileOf(data);
    const ok = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store: null,
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => new Response(chunked(data, 4_096)),
    });
    expect(ok?.status).toBe(200);
    expect(new Uint8Array(await ok!.arrayBuffer())).toEqual(data);
    const evil = data.slice();
    evil[0] = evil[0]! ^ 1;
    const bad = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store: null,
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => new Response(chunked(evil, 4_096)),
    });
    expect(bad?.status).toBe(200);
    await expect(bad!.arrayBuffer()).rejects.toThrow(DICTATION_TAMPERED);
  });

  test("a store that doesn't keep what it was given still gets the app its file, fetched again and verified", async () => {
    const file = await fakeFile();
    let upstreamCalls = 0;
    const store: DictationStore = { read: async () => null, write: async (_sha, body) => void (await new Response(body).arrayBuffer()) };
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), {
      store,
      hasher: bunHasher,
      ip: null,
      allow: () => true,
      lookup: () => file,
      upstream: async () => ((upstreamCalls += 1), new Response(bytes)),
    });
    expect(res?.status).toBe(200);
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(bytes);
    expect(upstreamCalls).toBe(2);
  });

  test("an upstream that's down or answers an error says so", async () => {
    const file = await fakeFile();
    for (const upstream of [async () => new Response("no", { status: 503 }), async () => Promise.reject(new Error("offline"))]) {
      const res = await onDictationHttp(get(`/v1/dictation/${name}`), { store: memoryStore(), hasher: bunHasher, ip: null, allow: () => true, lookup: () => file, upstream });
      expect(res?.status).toBe(502);
      expect(await res!.text()).toBe(`${DICTATION_UNREACHABLE}\n`);
    }
  });

  test("only allowlisted names, only GET and HEAD, no query: never a proxy", async () => {
    let upstreamCalls = 0;
    const deps = { store: memoryStore(), hasher: bunHasher, ip: null, allow: () => true, upstream: async () => ((upstreamCalls += 1), new Response(bytes)) };
    for (const path of [
      "/v1/dictation/whisper-base%2F..%2F..%2Fetc%2Fpasswd",
      "/v1/dictation/https://evil.example/x",
      "/v1/dictation/",
      `/v1/dictation/${name}?url=https://evil.example`,
      "/v1/dictation/whisper-base/model.onnx",
    ])
      expect((await onDictationHttp(get(path), deps))?.status).toBe(404);
    expect(await onDictationHttp(get("/v1/dictation/whisper-base/../../etc/passwd"), deps)).toBeNull();
    expect((await onDictationHttp(get(`/v1/dictation/${name}`, "POST"), deps))?.status).toBe(405);
    expect(await onDictationHttp(get("/v1/mailbox/x"), deps)).toBeNull();
    expect(upstreamCalls).toBe(0);
  });

  test("an address past its download limit is told to wait", async () => {
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), { store: memoryStore(), hasher: bunHasher, ip: "203.0.113.9", allow: () => false });
    expect(res?.status).toBe(429);
    expect(await res!.text()).toBe(`${DICTATION_TOO_MANY}\n`);
    const now = 1_000_000;
    for (let i = 0; i < 32; i++) expect(downloadAllowed("198.51.100.7", now + i)).toBe(true);
    expect(downloadAllowed("198.51.100.7", now + 40)).toBe(false);
    expect(downloadAllowed("198.51.100.8", now + 40)).toBe(true);
    expect(downloadAllowed("198.51.100.7", now + 60 * 60_000 + 1)).toBe(true);
  });

  test("the manifest pins every file to an exact upstream with its size and SHA-256", () => {
    for (const [n, f] of Object.entries(DICTATION_FILES)) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toBeGreaterThan(0);
      expect(
        f.url.startsWith("https://huggingface.co/onnx-community/whisper-base/resolve/1846881b6b3a3024392c1eea3ad983695bc23925/") || f.url.startsWith("https://cdn.jsdelivr.net/npm/onnxruntime-web@"),
      ).toBe(true);
      expect(dictationFile(n)).toBe(f);
    }
    expect(dictationFile("constructor")).toBeNull();
    expect(dictationFile("__proto__")).toBeNull();
    expect(Math.round(DICTATION_BYTES / 1e6)).toBe(107);
  });

  test("the pinned runtime is the one the app bundles", async () => {
    const transformers = Bun.resolveSync("@huggingface/transformers/package.json", join(import.meta.dir, "../web"));
    const glue = Bun.resolveSync("onnxruntime-web/package.json", join(transformers, ".."));
    const wasm = join(glue, "..", "dist", "ort-wasm-simd-threaded.asyncify.wasm");
    expect(await sha256Hex(new Uint8Array(readFileSync(wasm)))).toBe(DICTATION_FILES["ort/ort-wasm-simd-threaded.asyncify.wasm"]!.sha256);
  });

  test("the Bun relay serves the route, keeps verified files under its data folder, and answers no-store", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "kiwi-dictation-relay-"));
    made.push(dataDir);
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, dictationUpstream: async () => new Response("not the real file") });
    try {
      const base = server.url.origin;
      expect((await fetch(`${base}/v1/dictation/whisper-base/nope.json`)).status).toBe(404);
      const tampered = await fetch(`${base}/v1/dictation/${name}`);
      expect(tampered.status).toBe(502);
      expect(tampered.headers.get("cache-control")).toBe("no-store");
      expect(existsSync(join(dataDir, "dictation", DICTATION_FILES[name]!.sha256))).toBe(false);
      expect(existsSync(join(dataDir, "dictation")) ? readdirSync(join(dataDir, "dictation")) : []).toEqual([]);
    } finally {
      server.stop(true);
    }
  });
});

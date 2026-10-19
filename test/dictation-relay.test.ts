import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DICTATION_BYTES, DICTATION_FILES, dictationFile, sha256Hex, type DictationFile } from "@kiwi/core/dictation.ts";
import { downloadAllowed } from "../src/relay/address.ts";
import { startRelay } from "../src/relay/bun.ts";
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
  return { kept, read: async (sha) => (kept.has(sha) ? new Blob([kept.get(sha)!]) : null), write: async (sha, b) => void kept.set(sha, b) };
}

const get = (path: string, method = "GET") => new Request(`https://relay.test${path}`, { method });

describe("the relay's dictation route", () => {
  test("serves an allowlisted file it fetched and verified, keeps it, and serves the kept copy next time", async () => {
    const file = await fakeFile();
    const store = memoryStore();
    let upstreamCalls = 0;
    const deps = {
      store,
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
      const res = await onDictationHttp(get(`/v1/dictation/${name}`), { store, ip: null, allow: () => true, lookup: () => file, upstream: async () => new Response(sent) });
      expect(res?.status).toBe(502);
      expect(await res!.text()).toBe(`${DICTATION_TAMPERED}\n`);
      expect(store.kept.size).toBe(0);
    }
  });

  test("an upstream that's down or answers an error says so", async () => {
    const file = await fakeFile();
    for (const upstream of [async () => new Response("no", { status: 503 }), async () => Promise.reject(new Error("offline"))]) {
      const res = await onDictationHttp(get(`/v1/dictation/${name}`), { store: memoryStore(), ip: null, allow: () => true, lookup: () => file, upstream });
      expect(res?.status).toBe(502);
      expect(await res!.text()).toBe(`${DICTATION_UNREACHABLE}\n`);
    }
  });

  test("only allowlisted names, only GET and HEAD, no query: never a proxy", async () => {
    let upstreamCalls = 0;
    const deps = { store: memoryStore(), ip: null, allow: () => true, upstream: async () => ((upstreamCalls += 1), new Response(bytes)) };
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
    const res = await onDictationHttp(get(`/v1/dictation/${name}`), { store: memoryStore(), ip: "203.0.113.9", allow: () => false });
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
    } finally {
      server.stop(true);
    }
  });
});

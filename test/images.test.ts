// Message images are the same raster list as icons. SVG is refused on send and dropped on receive.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImages } from "../src/attach.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel, keepBlobsIn } from "@kiwi/core/client.ts";
import { run } from "@kiwi/core/client/relay.ts";
import { fileBlobs } from "../src/config.ts";
import { seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, type Identity } from "@kiwi/core/identity.ts";
import { imageMarker, MAX_BLOB_BYTES, MAX_FULL_IMAGE_BYTES, PROTOCOL_VERSION, type ImageAttachment } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { incoming, readCapped } from "../src/relay/http.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-images-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let ownerCh: Channel;
let memberCh: Channel;
let member: Identity;

const png: ImageAttachment = { name: "a.png", mime: "image/png", data: Buffer.from("png").toString("base64") };
const svg: ImageAttachment = { name: "b.svg", mime: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" });
  ownerCh = new Channel(made.access, relay, owner);
  member = await generateIdentity("win");
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
  const st = await Channel.joinStatus(relay, made.code, member, ask.requestId);
  memberCh = new Channel((st as { access: import("@kiwi/core/crypto.ts").ChannelAccess }).access, relay, member);
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

test("send refuses an svg attachment", async () => {
  await expect(memberCh.send("look", { imgs: [svg] })).rejects.toThrow(/png, jpg, gif or webp/);
});

test("send refuses an image with neither bytes nor a reference", async () => {
  await expect(memberCh.send("empty", { imgs: [{ name: "e.png", mime: "image/png" }] })).rejects.toThrow(/bytes or a stored reference/);
});

test("a png attachment is kept", async () => {
  const seq = await memberCh.send("just png", { imgs: [png] });
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq);
  expect(got?.imgs).toEqual([png]);
});

/** Post ciphertext the way a member who skipped the send check would. */
async function post(imgs: ImageAttachment[], body: string): Promise<number> {
  const signed = await sign(member, {
    v: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    from: "win",
    kind: "msg" as const,
    body,
    imgs,
    ts: Date.now(),
  });
  const e = memberCh.access.epoch;
  const sealed = await seal(memberCh.access.keys[String(e)]!, memberCh.roomId, signed);
  const raw = JSON.stringify({ ...sealed, e });
  const auth = await signRequest(member, memberCh.roomId, "POST", "/messages", raw);
  const res = await fetch(`${relay}/v1/rooms/${memberCh.roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
    body: raw,
  });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { seq: number }).seq;
}

test("an svg posted beside a png is dropped on receive, and the png stays", async () => {
  const seq = await post([png, svg], "both");
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq);
  expect(got?.body).toBe("both");
  expect(got?.imgs).toEqual([png]);
});

test("a message that is only an svg keeps its text and loses the image", async () => {
  const seq = await post([svg], "only svg");
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq);
  expect(got?.body).toBe("only svg");
  expect(got?.imgs).toBeUndefined();
});

test("the cli refuses an svg file", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-images-cli-"));
  try {
    const path = join(dir, "pic.svg");
    writeFileSync(path, "<svg/>");
    expect(() => loadImages([path])).toThrow(/png, jpg, gif or webp/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with image refs on, an image travels as a reference and reads back byte for byte", async () => {
  keepBlobsIn({ get: () => null, set: () => {}, drop: () => {} });
  const raw = crypto.getRandomValues(new Uint8Array(4096));
  const img: ImageAttachment = { name: "r.png", mime: "image/png", data: Buffer.from(raw).toString("base64") };
  const inline = await memberCh.send("inline still", { imgs: [img] });
  expect((await ownerCh.history(inline - 1)).messages.find((m) => m.seq === inline)?.imgs).toEqual([img]);
  await ownerCh.setImageRefs(true);
  expect(await memberCh.imageRefs()).toBe(true);
  const seq = await memberCh.send("by ref", { imgs: [img] });
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq)!;
  const ref = got.imgs?.[0];
  expect(ref?.data).toBeUndefined();
  expect(ref?.ref?.size).toBe(raw.length);
  expect(await ownerCh.image(ref!)).toBe(img.data!);
  expect(await ownerCh.image({ ...ref!, ref: { ...ref!.ref!, key: "A".repeat(43) } })).toBeNull();
  expect(await ownerCh.image({ ...ref!, ref: { ...ref!.ref!, id: "0".repeat(64) } })).toBeNull();
  await ownerCh.setImageRefs(false);
  const back = await memberCh.send("inline again", { imgs: [img] });
  expect((await ownerCh.history(back - 1)).messages.find((m) => m.seq === back)?.imgs).toEqual([img]);
});

test("a damaged image in the local cache is fetched again from the relay", async () => {
  const kept = new Map<string, Uint8Array<ArrayBuffer>>();
  keepBlobsIn({ get: (_, id) => kept.get(id) ?? null, set: (_, id, blob) => void kept.set(id, blob), drop: (_, id) => void kept.delete(id) });
  const raw = crypto.getRandomValues(new Uint8Array(2048));
  const img: ImageAttachment = { name: "c.png", mime: "image/png", data: Buffer.from(raw).toString("base64") };
  await ownerCh.setImageRefs(true);
  const seq = await memberCh.send("cached", { imgs: [img] });
  await ownerCh.setImageRefs(false);
  const ref = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq)!.imgs![0]!;
  const id = ref.ref!.id;
  kept.set(id, kept.get(id)!.slice(0, 100));
  expect(await ownerCh.image(ref)).toBe(img.data!);
  expect(kept.get(id)!.length).toBeGreaterThan(100);
});

test("the relay stores an image only under the hash of its bytes", async () => {
  const bytes = new Uint8Array(100).fill(1);
  const id = "f".repeat(64);
  const auth = await signRequest(member, memberCh.roomId, "PUT", `/blobs/${id}`, "");
  const res = await fetch(`${relay}/v1/rooms/${memberCh.roomId}/blobs/${id}`, { method: "PUT", headers: { authorization: `Bearer ${auth}` }, body: bytes });
  expect(res.status).toBe(400);
});

test("the relay reads no image bytes before it checks the sender, and stops reading at the cap", async () => {
  const chunk = 64 * 1024;
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled += chunk;
      c.enqueue(new Uint8Array(chunk));
      if (pulled >= 8 * 1024 * 1024) c.close();
    },
  });
  const path = `/blobs/${"0".repeat(64)}`;
  const req = new Request(`http://relay/v1/rooms/x${path}`, { method: "PUT", body });
  await incoming(req, path);
  expect(pulled).toBeLessThan(MAX_BLOB_BYTES);
  expect(await readCapped(req, MAX_BLOB_BYTES)).toBeNull();
  expect(pulled).toBeLessThanOrEqual(MAX_BLOB_BYTES + 2 * chunk);
});

test("the relay refuses an image bigger than the cap", async () => {
  const id = "a".repeat(64);
  const put = async (headers: Record<string, string>) => (await fetch(`${relay}/v1/rooms/${memberCh.roomId}/blobs/${id}`, { method: "PUT", headers, body: new Uint8Array(MAX_BLOB_BYTES + 1) })).status;
  expect(await put({})).toBe(401);
  expect(await put({ authorization: `Bearer ${await signRequest(member, memberCh.roomId, "PUT", `/blobs/${id}`, "")}` })).toBe(413);
});

test("a cached image the relay no longer has is removed from the cache", async () => {
  const gone = "0".repeat(64);
  const kept = new Map<string, Uint8Array<ArrayBuffer>>([[gone, new Uint8Array(10)]]);
  keepBlobsIn({ get: (_, id) => kept.get(id) ?? null, set: (_, id, blob) => void kept.set(id, blob), drop: (_, id) => void kept.delete(id) });
  const img: ImageAttachment = { name: "g.png", mime: "image/png", ref: { id: gone, key: "A".repeat(43), size: 2048 } };
  expect(await ownerCh.image(img)).toBeNull();
  expect(kept.has(gone)).toBe(false);
});

test("the local image cache keeps a channel under its cap and removes the least recently used first", () => {
  const was = process.env.KIWI_HOME;
  const home = mkdtempSync(join(tmpdir(), "kiwi-blobs-"));
  process.env.KIWI_HOME = home;
  try {
    const blobs = fileBlobs(250);
    const room = "f".repeat(32);
    const [a, b, c] = ["a", "b", "c"].map((x) => x.repeat(64)) as [string, string, string];
    const path = (id: string) => join(home, "cache", `${room}.blobs`, id);
    blobs.set(room, a, new Uint8Array(100));
    blobs.set(room, b, new Uint8Array(100));
    const now = Date.now() / 1000;
    utimesSync(path(a), now - 100, now - 100);
    utimesSync(path(b), now - 50, now - 50);
    expect(blobs.get(room, a)?.length).toBe(100);
    blobs.set(room, c, new Uint8Array(100));
    expect(existsSync(path(a))).toBe(true);
    expect(existsSync(path(b))).toBe(false);
    expect(existsSync(path(c))).toBe(true);
    blobs.drop(room, a);
    expect(existsSync(path(a))).toBe(false);
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    rmSync(home, { recursive: true, force: true });
  }
});

test("a full-size image goes as a blob with its preview inline: new readers get the full image, a lost blob falls back to the preview", async () => {
  keepBlobsIn({ get: () => null, set: () => {}, drop: () => {} });
  const full = Buffer.from(crypto.getRandomValues(new Uint8Array(600 * 1024))).toString("base64");
  const preview = Buffer.from("small webp").toString("base64");
  const seq = await memberCh.send("full size", { imgs: [{ name: "shot.png", mime: "image/webp", data: preview, full: { mime: "image/png", data: full } }] });
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq)!.imgs![0]!;
  expect(got).toEqual({ name: "shot.png", mime: "image/webp", data: preview, ref: { id: expect.any(String), key: expect.any(String), size: 600 * 1024, mime: "image/png" } });
  expect(imageMarker(got)).toBe("[image: shot.png (600KB)]");
  expect(await ownerCh.image(got)).toBe(full);
  expect(await run(ownerCh.fx.images([got]))).toEqual([{ name: "shot.png", mime: "image/png", data: full }]);
  const lost = { ...got, ref: { ...got.ref!, id: "0".repeat(64) } };
  expect(await run(ownerCh.fx.images([lost]))).toEqual([{ name: "shot.png", mime: "image/webp", data: preview }]);
});

test("send refuses a full-size image over the cap", async () => {
  const over = Buffer.alloc(MAX_FULL_IMAGE_BYTES + 1024).toString("base64");
  const preview = Buffer.from("p").toString("base64");
  await expect(memberCh.send("too big", { imgs: [{ name: "big.png", mime: "image/webp", data: preview, full: { mime: "image/png", data: over } }] })).rejects.toThrow(/full-size image/);
});

test("a full-size image with no preview goes as the blob alone and reads back", async () => {
  keepBlobsIn({ get: () => null, set: () => {}, drop: () => {} });
  const full = Buffer.from(crypto.getRandomValues(new Uint8Array(300 * 1024))).toString("base64");
  const seq = await memberCh.send("no preview", { imgs: [{ name: "np.png", mime: "image/png", full: { mime: "image/png", data: full } }] });
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq)!.imgs![0]!;
  expect(got.data).toBeUndefined();
  expect(got.ref?.size).toBe(300 * 1024);
  expect(await ownerCh.image(got)).toBe(full);
});

// Blob seal, store and read, pinned against the original files.ts and images.ts callers (#2434, spec #9645).
// Every expectation here was first run on base c0b633e00 before the shared helper existed.

import { beforeEach, describe, expect, test } from "bun:test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Channel, fetchRelay, keepBlobsIn, Relay } from "@kiwi/core/client.ts";
import { ChannelCore } from "@kiwi/core/client/core.ts";
import { RelayError, Unreachable, type Refusal } from "@kiwi/core/client/errors.ts";
import { ChannelFiles } from "@kiwi/core/client/files.ts";
import { ChannelImages } from "@kiwi/core/client/images.ts";
import { ChannelInfo, type Info } from "@kiwi/core/client/info.ts";
import type { RelayApi } from "@kiwi/core/client/relay.ts";
import { ChannelSettings } from "@kiwi/core/client/settings.ts";
import { newChannelKey, newRoomId, openBlob, sealBlob, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { FILE_PIECE_BYTES, MAX_FILE_BYTES, MAX_IMAGE_BYTES, type FileAttachment, type ImageAttachment } from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";

const RELAY = "http://relay.invalid";

type Failure = { fail: Refusal } | { die: unknown };
type Call = { relay: string; roomId: string; id: string; identity: Identity; put: Uint8Array<ArrayBuffer> | undefined };

interface Scene {
  core: ChannelCore;
  files: ChannelFiles;
  images: ChannelImages;
  calls: Call[];
  stored: Map<string, Uint8Array<ArrayBuffer>>;
  putFails: Map<number, Failure>;
  getFails: Map<string, Failure>;
  getDelay: Map<string, number>;
  infoCalls: { count: number };
  info: { value: Info | Failure };
  settings: { value: Record<string, unknown> | null | Failure; calls: number };
  cache: Map<string, Uint8Array<ArrayBuffer>>;
  cacheLog: string[];
  run<A, E>(fx: Effect.Effect<A, E, Relay>): Promise<Outcome<A>>;
}

type Outcome<A> = { kind: "ok"; value: A } | { kind: "fail"; error: unknown } | { kind: "die"; defect: unknown };

let identity: Identity;

const baseInfo = (extra: Partial<Info>): Info => ({ ownerPk: "pk", ownerXpk: "xpk", ownerSig: "sig", epoch: 0, rotate: false, ...extra });

const failed = (f: Failure) => ("fail" in f ? Effect.fail(f.fail) : Effect.die(f.die));
const isFailure = (x: unknown): x is Failure => typeof x === "object" && x !== null && ("fail" in x || "die" in x);

async function scene(info: Partial<Info> = { blobs: true, files: true }): Promise<Scene> {
  identity ??= await generateIdentity("tester");
  const access: ChannelAccess = { roomId: newRoomId(), ownerPk: identity.pk, ownerXpk: identity.xpk!, epoch: 0, keys: { "0": newChannelKey() } };
  const core = new ChannelCore(access, RELAY, identity);
  const calls: Call[] = [];
  const stored = new Map<string, Uint8Array<ArrayBuffer>>();
  const putFails = new Map<number, Failure>();
  const getFails = new Map<string, Failure>();
  const getDelay = new Map<string, number>();
  const infoCalls = { count: 0 };
  const infoBox: { value: Info | Failure } = { value: baseInfo(info) };
  const settingsBox: { value: Record<string, unknown> | null | Failure; calls: number } = { value: { imageRefs: true }, calls: 0 };
  const cache = new Map<string, Uint8Array<ArrayBuffer>>();
  const cacheLog: string[] = [];
  keepBlobsIn({
    get: (room, id) => {
      cacheLog.push(`get ${room === access.roomId ? "room" : room} ${id}`);
      return cache.get(id) ?? null;
    },
    set: (room, id, blob) => {
      cacheLog.push(`set ${room === access.roomId ? "room" : room} ${id}`);
      cache.set(id, blob);
    },
    drop: (room, id) => {
      cacheLog.push(`drop ${room === access.roomId ? "room" : room} ${id}`);
      cache.delete(id);
    },
  });
  let puts = 0;
  const relayApi: RelayApi = {
    ...fetchRelay,
    blob: (relay, roomId, id, who, put) =>
      Effect.suspend(() => {
        calls.push({ relay, roomId, id, identity: who, put });
        if (put) {
          const failure = putFails.get(puts++);
          if (failure) return failed(failure);
          stored.set(id, put);
          return Effect.succeed(new Uint8Array(0));
        }
        const failure = getFails.get(id);
        if (failure) return failed(failure);
        const got = stored.get(id);
        if (!got) return Effect.fail(new RelayError(404, "no such blob"));
        const delay = getDelay.get(id) ?? 0;
        return delay ? Effect.as(Effect.sleep(delay), got) : Effect.succeed(got);
      }),
  };
  const files = new ChannelFiles(core);
  const settings = new ChannelSettings(core, new ChannelInfo(core, {}));
  settings.settings = () =>
    Effect.suspend(() => {
      settingsBox.calls++;
      const v = settingsBox.value;
      return isFailure(v) ? failed(v) : Effect.succeed(v);
    });
  const images = new ChannelImages(core, settings);
  core.fx = {
    ...new Channel(access, RELAY, identity).fx,
    info: () =>
      Effect.suspend(() => {
        infoCalls.count++;
        const v = infoBox.value;
        return isFailure(v) ? failed(v) : Effect.succeed(v);
      }),
    ...images.fx,
    ...files.fx,
  };
  const run = async <A, E>(fx: Effect.Effect<A, E, Relay>): Promise<Outcome<A>> => {
    const exit = await Effect.runPromiseExit(Effect.provideService(fx, Relay, relayApi));
    if (Exit.isSuccess(exit)) return { kind: "ok", value: exit.value };
    const reason = exit.cause.reasons[0];
    if (reason && Cause.isFailReason(reason)) return { kind: "fail", error: reason.error };
    if (reason && Cause.isDieReason(reason)) return { kind: "die", defect: reason.defect };
    throw new Error("interrupted");
  };
  return { core, files, images, calls, stored, putFails, getFails, getDelay, infoCalls, info: infoBox, settings: settingsBox, cache, cacheLog, run };
}

function noise(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += 65_536) crypto.getRandomValues(out.subarray(at, Math.min(n, at + 65_536)));
  return out;
}

const b64 = (raw: Uint8Array<ArrayBuffer>): string => Buffer.from(raw).toString("base64");
const same = (a: Uint8Array | null | undefined, b: Uint8Array): boolean => a != null && Buffer.from(a).equals(Buffer.from(b));
const value = <A>(o: Outcome<A>): A => {
  if (o.kind !== "ok") throw new Error(`expected success, got ${o.kind}: ${String(o.kind === "fail" ? o.error : o.defect)}`);
  return o.value;
};
const error = <A>(o: Outcome<A>): unknown => {
  if (o.kind !== "fail") throw new Error(`expected a failure, got ${o.kind}`);
  return o.error;
};

const notMember = () => new RelayError(403, "not a member of this channel", "NotMember");
const noChannel = () => new RelayError(404, "no such channel");
const serverError = () => new RelayError(500, "relay broke");
const offline = () => new Unreachable({ cause: new Error("down"), url: RELAY });

function expectSentBy(s: Scene, call: Call): void {
  expect(call.relay).toBe(RELAY);
  expect(call.roomId).toBe(s.core.roomId);
  expect(call.identity).toBe(s.core.identity);
}

beforeEach(() => keepBlobsIn({ get: () => null, set: () => {}, drop: () => {} }));

describe("putFile", () => {
  test("seals each piece under a fresh key and stores it under the hash of its ciphertext, in order", async () => {
    const s = await scene();
    const bytes = noise(2 * FILE_PIECE_BYTES + 777);
    const f = value(await s.run(s.files.fx.putFile("r.pdf", "application/pdf", bytes)));
    expect(f).toMatchObject({ name: "r.pdf", mime: "application/pdf", size: bytes.length });
    expect(f.pieces.map((p) => p.size)).toEqual([FILE_PIECE_BYTES, FILE_PIECE_BYTES, 777]);
    expect(new Set(f.pieces.map((p) => p.key)).size).toBe(3);
    expect(s.calls).toHaveLength(3);
    for (const [i, piece] of f.pieces.entries()) {
      const call = s.calls.find((c) => c.id === piece.id)!;
      expectSentBy(s, call);
      const opened = await openBlob(piece, call.put!);
      expect(same(opened, bytes.subarray(i * FILE_PIECE_BYTES, i * FILE_PIECE_BYTES + piece.size))).toBe(true);
    }
    expect(s.infoCalls.count).toBe(1);
  });

  test("an empty mime becomes application/octet-stream", async () => {
    const s = await scene();
    expect(value(await s.run(s.files.fx.putFile("x.bin", "", noise(10)))).mime).toBe("application/octet-stream");
  });

  test("refuses an empty file before asking for info or storing", async () => {
    const s = await scene();
    const e = error(await s.run(s.files.fx.putFile("e.txt", "text/plain", new Uint8Array(0))));
    expect(e).toBeInstanceOf(Rejected);
    expect((e as Rejected).message).toBe("e.txt is empty");
    expect(s.infoCalls.count).toBe(0);
    expect(s.calls).toHaveLength(0);
  });

  test("refuses an oversize file in MB before asking for info", async () => {
    const s = await scene();
    const e = error(await s.run(s.files.fx.putFile("big.iso", "x/y", new Uint8Array(MAX_FILE_BYTES + 1))));
    expect((e as Rejected).message).toBe("big.iso is 25 MB; a file is at most 25 MB");
    expect(s.infoCalls.count).toBe(0);
    expect(s.calls).toHaveLength(0);
  });

  test("checks the files flag, not the blobs flag", async () => {
    const off = await scene({ blobs: true, files: false });
    expect((error(await off.run(off.files.fx.putFile("a", "b", noise(5)))) as Rejected).message).toBe("this channel's relay doesn't hold files yet: it needs an update");
    expect(off.calls).toHaveLength(0);
    const on = await scene({ blobs: false, files: true });
    expect(value(await on.run(on.files.fx.putFile("a", "b", noise(5)))).pieces).toHaveLength(1);
  });

  test("checks the attachment metadata only after the pieces are stored", async () => {
    const s = await scene();
    const e = error(await s.run(s.files.fx.putFile("n".repeat(5000), "b", noise(5))));
    expect((e as Rejected).message).toMatch(/can't be attached: its name or type is too long$/);
    expect(s.calls).toHaveLength(1);
  });

  test("maps store errors through gone(): NotMember and no-such-channel become ChannelGone, others stay", async () => {
    const cases: [() => Refusal, (e: unknown) => void][] = [
      [notMember, (e) => expect(e).toMatchObject({ _tag: "ChannelGone", why: "removed" })],
      [noChannel, (e) => expect(e).toMatchObject({ _tag: "ChannelGone", why: "closed" })],
      [serverError, (e) => expect(e).toMatchObject({ _tag: "RelayError", status: 500 })],
      [offline, (e) => expect(e).toBeInstanceOf(Unreachable)],
    ];
    for (const [make, check] of cases) {
      const s = await scene();
      s.putFails.set(0, { fail: make() });
      check(error(await s.run(s.files.fx.putFile("f", "b", noise(5)))));
    }
  });

  test("a store failure on one piece fails the file and returns no attachment", async () => {
    const s = await scene();
    s.putFails.set(1, { fail: serverError() });
    const out = await s.run(s.files.fx.putFile("f", "b", noise(FILE_PIECE_BYTES + 5)));
    expect(out.kind).toBe("fail");
  });

  test("a defect while storing stays a defect", async () => {
    const s = await scene();
    s.putFails.set(0, { die: new Error("bug") });
    expect((await s.run(s.files.fx.putFile("f", "b", noise(5)))).kind).toBe("die");
  });
});

describe("file", () => {
  async function stored(s: Scene, n: number): Promise<{ f: FileAttachment; bytes: Uint8Array<ArrayBuffer> }> {
    const bytes = noise(n);
    const f = value(await s.run(s.files.fx.putFile("r.bin", "x/y", bytes)));
    s.calls.length = 0;
    return { f, bytes };
  }

  test("reads every piece and reassembles them in order, whatever order they arrive in", async () => {
    const s = await scene();
    const { f, bytes } = await stored(s, 2 * FILE_PIECE_BYTES + 99);
    s.getDelay.set(f.pieces[0]!.id, 30);
    s.getDelay.set(f.pieces[1]!.id, 15);
    const back = value(await s.run(s.files.fx.file(f)));
    expect(same(back, bytes)).toBe(true);
    expect(s.calls.map((c) => c.id).sort()).toEqual(f.pieces.map((p) => p.id).sort());
    for (const c of s.calls) {
      expectSentBy(s, c);
      expect(c.put).toBeUndefined();
    }
  });

  test("a missing piece (plain 404) makes the whole file null", async () => {
    const s = await scene();
    const { f } = await stored(s, FILE_PIECE_BYTES + 3);
    s.stored.delete(f.pieces[1]!.id);
    expect(value(await s.run(s.files.fx.file(f)))).toBeNull();
  });

  test("a 404 that means the channel is gone fails with ChannelGone, not null", async () => {
    const s = await scene();
    const { f } = await stored(s, 10);
    s.getFails.set(f.pieces[0]!.id, { fail: noChannel() });
    expect(error(await s.run(s.files.fx.file(f)))).toMatchObject({ _tag: "ChannelGone", why: "closed" });
  });

  test("NotMember, server and network errors fail the read", async () => {
    for (const [make, tag] of [
      [notMember, "ChannelGone"],
      [serverError, "RelayError"],
      [offline, "Unreachable"],
    ] as const) {
      const s = await scene();
      const { f } = await stored(s, 10);
      s.getFails.set(f.pieces[0]!.id, { fail: make() });
      expect(error(await s.run(s.files.fx.file(f)))).toMatchObject({ _tag: tag });
    }
  });

  test("a wrong key, a mismatched id, tampered bytes or a wrong declared size each read as null", async () => {
    const s = await scene();
    const { f } = await stored(s, 100);
    const p = f.pieces[0]!;
    const other = await sealBlob(noise(100));
    s.stored.set(other.id, other.blob);
    const tampered = s.stored.get(p.id)!.slice();
    tampered[tampered.length - 1]! ^= 1;
    const variants: FileAttachment[] = [
      { ...f, pieces: [{ ...p, key: other.key }] },
      { ...f, pieces: [{ ...other, size: 100, id: p.id, key: other.key }] },
      { ...f, pieces: [{ ...p, size: 99 }] },
    ];
    for (const v of variants) expect(value(await s.run(s.files.fx.file(v)))).toBeNull();
    s.stored.set(p.id, tampered);
    expect(value(await s.run(s.files.fx.file(f)))).toBeNull();
  });
});

describe("putImage", () => {
  test("seals the decoded bytes, stores them, then caches exactly the stored ciphertext", async () => {
    const s = await scene();
    const raw = noise(3000);
    const out = value(await s.run(s.images.fx.putImage({ name: "p.png", mime: "image/png", data: b64(raw) })));
    expect(out).toMatchObject({ name: "p.png", mime: "image/png", ref: { size: 3000 } });
    expect(out.data).toBeUndefined();
    expect(s.calls).toHaveLength(1);
    expectSentBy(s, s.calls[0]!);
    expect(s.calls[0]!.id).toBe(out.ref!.id);
    expect(same(await openBlob(out.ref!, s.calls[0]!.put!), raw)).toBe(true);
    expect(s.cacheLog).toEqual([`set room ${out.ref!.id}`]);
    expect(s.cache.get(out.ref!.id)).toBe(s.calls[0]!.put!);
  });

  test("two uploads of the same bytes get different keys and ids", async () => {
    const s = await scene();
    const raw = noise(100);
    const a = value(await s.run(s.images.fx.putImage({ name: "a", mime: "image/png", data: b64(raw) })));
    const b = value(await s.run(s.images.fx.putImage({ name: "a", mime: "image/png", data: b64(raw) })));
    expect(a.ref!.key).not.toBe(b.ref!.key);
    expect(a.ref!.id).not.toBe(b.ref!.id);
  });

  test("refuses empty, oversize (in KB) and blobs-off before storing or caching", async () => {
    const s = await scene();
    expect((error(await s.run(s.images.fx.putImage({ name: "e.png", mime: "image/png", data: "" }))) as Rejected).message).toBe("e.png is empty");
    expect(s.infoCalls.count).toBe(0);
    expect((error(await s.run(s.images.fx.putImage({ name: "b.png", mime: "image/png", data: b64(new Uint8Array(MAX_IMAGE_BYTES + 1)) }))) as Rejected).message).toBe(
      "b.png is 257 KB; an image is at most 256 KB",
    );
    expect(s.infoCalls.count).toBe(0);
    const off = await scene({ blobs: false, files: true });
    expect((error(await off.run(off.images.fx.putImage({ name: "o.png", mime: "image/png", data: b64(noise(5)) }))) as Rejected).message).toBe(
      "this channel's relay doesn't hold images yet: it needs an update",
    );
    expect(s.calls.length + off.calls.length).toBe(0);
    expect(s.cacheLog.length + off.cacheLog.length).toBe(0);
  });

  test("maps store errors through gone() and caches nothing on failure", async () => {
    for (const [make, tag] of [
      [notMember, "ChannelGone"],
      [noChannel, "ChannelGone"],
      [serverError, "RelayError"],
      [offline, "Unreachable"],
    ] as const) {
      const s = await scene();
      s.putFails.set(0, { fail: make() });
      expect(error(await s.run(s.images.fx.putImage({ name: "p", mime: "image/png", data: b64(noise(5)) })))).toMatchObject({ _tag: tag });
      expect(s.cacheLog).toEqual([]);
    }
  });
});

describe("image", () => {
  async function uploaded(s: Scene, n = 500): Promise<{ img: ImageAttachment; raw: Uint8Array<ArrayBuffer> }> {
    const raw = noise(n);
    const img = value(await s.run(s.images.fx.putImage({ name: "p.png", mime: "image/png", data: b64(raw) })));
    s.calls.length = 0;
    s.cacheLog.length = 0;
    return { img, raw };
  }

  test("inline data comes back as is, and a missing ref is null, with no relay call", async () => {
    const s = await scene();
    expect(value(await s.run(s.images.fx.image({ name: "a", mime: "image/png", data: "QUJD" })))).toBe("QUJD");
    expect(value(await s.run(s.images.fx.image({ name: "a", mime: "image/png" })))).toBeNull();
    expect(s.calls).toHaveLength(0);
  });

  test("a valid cached blob is used without a relay call", async () => {
    const s = await scene();
    const { img, raw } = await uploaded(s);
    expect(value(await s.run(s.images.fx.image(img)))).toBe(b64(raw));
    expect(s.calls).toHaveLength(0);
    expect(s.cacheLog).toEqual([`get room ${img.ref!.id}`]);
  });

  test("an invalid cached blob falls back to the relay and caches the fetched ciphertext", async () => {
    const s = await scene();
    const { img, raw } = await uploaded(s);
    s.cache.set(img.ref!.id, s.cache.get(img.ref!.id)!.slice(0, 40));
    expect(value(await s.run(s.images.fx.image(img)))).toBe(b64(raw));
    expect(s.calls).toHaveLength(1);
    expectSentBy(s, s.calls[0]!);
    expect(s.calls[0]!.put).toBeUndefined();
    expect(s.cacheLog).toEqual([`get room ${img.ref!.id}`, `set room ${img.ref!.id}`]);
    expect(s.cache.get(img.ref!.id)).toBe(s.stored.get(img.ref!.id)!);
  });

  test("a plain 404 is null and evicts the cache entry", async () => {
    const s = await scene();
    const { img } = await uploaded(s);
    s.cache.clear();
    s.stored.delete(img.ref!.id);
    expect(value(await s.run(s.images.fx.image(img)))).toBeNull();
    expect(s.cacheLog).toEqual([`get room ${img.ref!.id}`, `drop room ${img.ref!.id}`]);
  });

  test("a no-such-channel 404 fails with ChannelGone and leaves the cache alone", async () => {
    const s = await scene();
    const { img } = await uploaded(s);
    s.cache.clear();
    s.getFails.set(img.ref!.id, { fail: noChannel() });
    expect(error(await s.run(s.images.fx.image(img)))).toMatchObject({ _tag: "ChannelGone", why: "closed" });
    expect(s.cacheLog).toEqual([`get room ${img.ref!.id}`]);
  });

  test("NotMember, server and network errors fail the read and leave the cache alone", async () => {
    for (const [make, tag] of [
      [notMember, "ChannelGone"],
      [serverError, "RelayError"],
      [offline, "Unreachable"],
    ] as const) {
      const s = await scene();
      const { img } = await uploaded(s);
      s.cache.clear();
      s.getFails.set(img.ref!.id, { fail: make() });
      expect(error(await s.run(s.images.fx.image(img)))).toMatchObject({ _tag: tag });
      expect(s.cacheLog).toEqual([`get room ${img.ref!.id}`]);
    }
  });

  test("a wrong key, a mismatched id, tampered bytes or a wrong declared size read as null and cache nothing", async () => {
    const s = await scene();
    const { img } = await uploaded(s, 200);
    const ref = img.ref!;
    const other = await sealBlob(noise(200));
    s.stored.set(other.id, other.blob);
    const variants: ImageAttachment[] = [
      { ...img, ref: { ...ref, key: other.key } },
      { ...img, ref: { ...ref, id: other.id } },
      { ...img, ref: { ...ref, size: 199 } },
    ];
    for (const v of variants) {
      s.cache.clear();
      s.cacheLog.length = 0;
      expect(value(await s.run(s.images.fx.image(v)))).toBeNull();
      expect(s.cacheLog.filter((l) => l.startsWith("set"))).toEqual([]);
    }
    const tampered = s.stored.get(ref.id)!.slice();
    tampered[20]! ^= 1;
    s.stored.set(ref.id, tampered);
    s.cache.clear();
    s.cacheLog.length = 0;
    expect(value(await s.run(s.images.fx.image(img)))).toBeNull();
    expect(s.cacheLog.filter((l) => l.startsWith("set"))).toEqual([]);
  });

  test("images() reads each through image() and drops the ones that read as null", async () => {
    const s = await scene();
    const { img, raw } = await uploaded(s);
    const missing: ImageAttachment = { name: "m", mime: "image/png", ref: { ...img.ref!, id: "0".repeat(64) } };
    const out = value(await s.run(s.images.fx.images([img, missing])));
    expect(out).toEqual([{ name: "p.png", mime: "image/png", data: b64(raw) }]);
  });
});

describe("stored", () => {
  const inline = (raw: Uint8Array<ArrayBuffer>, name = "i.png"): ImageAttachment => ({ name, mime: "image/png", data: b64(raw) });

  test("a list with no inline image comes back as the same array without asking for info", async () => {
    const s = await scene();
    const imgs: ImageAttachment[] = [{ name: "r", mime: "image/png", ref: { id: "a".repeat(64), key: "k", size: 1 } }];
    expect(value(await s.run(s.images.stored(imgs)))).toBe(imgs);
    expect(s.infoCalls.count).toBe(0);
  });

  test("keeps every image inline when info fails, blobs are off, settings fail, or image refs are off", async () => {
    const setups: ((s: Scene) => void)[] = [
      (s) => void (s.info.value = { fail: serverError() }),
      (s) => void (s.info.value = baseInfo({ blobs: false, files: true })),
      (s) => void (s.settings.value = { fail: serverError() }),
      (s) => void (s.settings.value = null),
      (s) => void (s.settings.value = { imageRefs: false }),
    ];
    for (const setup of setups) {
      const s = await scene();
      setup(s);
      const imgs = [inline(noise(10))];
      expect(value(await s.run(s.images.stored(imgs)))).toBe(imgs);
      expect(s.calls).toHaveLength(0);
      expect(s.cacheLog).toEqual([]);
    }
  });

  test("turns inline images into refs, leaves refs alone, and caches each stored ciphertext", async () => {
    const s = await scene();
    const raw = noise(400);
    const already: ImageAttachment = { name: "r", mime: "image/png", ref: { id: "a".repeat(64), key: "k", size: 1 } };
    const out = value(await s.run(s.images.stored([inline(raw), already])));
    expect(out[1]).toBe(already);
    const ref = out[0]!.ref!;
    expect(out[0]).toEqual({ name: "i.png", mime: "image/png", ref });
    expect(ref.size).toBe(400);
    expect(s.calls).toHaveLength(1);
    expectSentBy(s, s.calls[0]!);
    expect(same(await openBlob(ref, s.calls[0]!.put!), raw)).toBe(true);
    expect(s.cacheLog).toEqual([`set room ${ref.id}`]);
  });

  test("does not apply putImage's empty or size checks", async () => {
    const s = await scene();
    const out = value(await s.run(s.images.stored([inline(new Uint8Array(0), "e"), inline(new Uint8Array(MAX_IMAGE_BYTES + 1), "big")])));
    expect(out.map((i) => i.ref?.size)).toEqual([0, MAX_IMAGE_BYTES + 1]);
  });

  test("a failed upload of any kind keeps that one image inline with no cache write, while the others go by ref", async () => {
    for (const make of [notMember, noChannel, serverError, offline]) {
      const s = await scene();
      s.putFails.set(0, { fail: make() });
      const first = inline(noise(10), "a");
      const out = value(await s.run(s.images.stored([first, inline(noise(10), "b")])));
      const kept = out.filter((i) => i.data !== undefined);
      const moved = out.filter((i) => i.ref !== undefined);
      expect(kept).toHaveLength(1);
      expect(moved).toHaveLength(1);
      expect(s.cacheLog).toEqual([`set room ${moved[0]!.ref!.id}`]);
    }
  });

  test("a defect while uploading stays a defect", async () => {
    const s = await scene();
    s.putFails.set(0, { die: new Error("bug") });
    expect((await s.run(s.images.stored([inline(noise(10))]))).kind).toBe("die");
  });
});

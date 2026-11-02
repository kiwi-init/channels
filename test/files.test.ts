import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFiles, saveFiles } from "../src/attach.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { formatMessage } from "@kiwi/core/format.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { FILE_PIECE_BYTES, fileAttachment, MAX_FILE_BYTES, MAX_FILES, type FileAttachment } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-files-"));
const scratch = mkdtempSync(join(tmpdir(), "kiwi-files-local-"));
let server: ReturnType<typeof startRelay>;
let owner: Identity;
let ownerCh: Channel;
let memberCh: Channel;

function noise(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += 65_536) crypto.getRandomValues(out.subarray(at, Math.min(n, at + 65_536)));
  return out;
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" });
  ownerCh = new Channel(made.access, relay, owner);
  const member = await generateIdentity("win");
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
  const st = await Channel.joinStatus(relay, made.code, member, ask.requestId);
  memberCh = new Channel((st as { access: ChannelAccess }).access, relay, member);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

test("a file of several pieces goes to the relay encrypted, travels on the message, and reads back byte for byte", async () => {
  const bytes = noise(2 * FILE_PIECE_BYTES + 12_345);
  const f = await memberCh.putFile("report.pdf", "application/pdf", bytes);
  expect(f.pieces.map((p) => p.size)).toEqual([FILE_PIECE_BYTES, FILE_PIECE_BYTES, 12_345]);
  expect(f.size).toBe(bytes.length);
  const seq = await memberCh.send("the report", { files: [f] });
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq);
  expect(got?.files).toEqual([f]);
  const back = await ownerCh.file(got!.files![0]!);
  expect(back && Buffer.from(back).equals(Buffer.from(bytes))).toBe(true);
  const first = f.pieces[0]!;
  const auth = await signRequest(owner, ownerCh.roomId, "GET", `/blobs/${first.id}`, "");
  const held = Buffer.from(await (await fetch(`${server.url.origin}/v1/rooms/${ownerCh.roomId}/blobs/${first.id}`, { headers: { authorization: `Bearer ${auth}` } })).arrayBuffer());
  expect(held.length).toBe(FILE_PIECE_BYTES + 28);
  expect(held.includes(Buffer.from(bytes.subarray(0, 64)))).toBe(false);
});

test("a file's size, pieces and name are checked: an empty or oversized file, or one not stored first, is refused", async () => {
  await expect(memberCh.putFile("empty.txt", "text/plain", new Uint8Array(0))).rejects.toThrow(/empty/);
  await expect(memberCh.putFile("huge.bin", "application/octet-stream", new Uint8Array(MAX_FILE_BYTES + 1))).rejects.toThrow(/at most 25 MB/);
  const unstored: FileAttachment = { name: "x.txt", mime: "text/plain", size: 10, pieces: [] };
  await expect(memberCh.send("look", { files: [unstored] })).rejects.toThrow(/stored pieces/);
  const one = await memberCh.putFile("a.txt", "text/plain", noise(10));
  await expect(memberCh.send("many", { files: Array.from({ length: MAX_FILES + 1 }, () => one) })).rejects.toThrow(/at most 8 files/);
});

test("a malformed file on a message is dropped on receive and the text stays", () => {
  const piece = { id: "a".repeat(64), key: "A".repeat(43), size: 10 };
  expect(fileAttachment({ name: "a.txt", mime: "text/plain", size: 10, pieces: [piece] })).toBe(true);
  expect(fileAttachment({ name: "a.txt", mime: "text/plain", size: 11, pieces: [piece] })).toBe(false);
  expect(fileAttachment({ name: "a.txt", mime: "text/plain", size: 10, pieces: [piece, piece] })).toBe(false);
  expect(fileAttachment({ name: "a.txt", mime: "text/plain", size: 10, pieces: [{ ...piece, id: "nope" }] })).toBe(false);
  expect(fileAttachment({ name: "", mime: "text/plain", size: 10, pieces: [piece] })).toBe(false);
  expect(fileAttachment({ name: "a.txt", mime: "text/plain", size: MAX_FILE_BYTES + 1, pieces: [piece] })).toBe(false);
  const big = {
    name: "b.bin",
    mime: "application/octet-stream",
    size: FILE_PIECE_BYTES + 1,
    pieces: [
      { ...piece, size: 1 },
      { ...piece, size: FILE_PIECE_BYTES },
    ],
  };
  expect(fileAttachment(big)).toBe(false);
});

test("a file whose pieces the relay no longer has reads as missing, not as broken bytes", async () => {
  const f: FileAttachment = { name: "gone.zip", mime: "application/zip", size: 20, pieces: [{ id: "0".repeat(64), key: "A".repeat(43), size: 20 }] };
  expect(await ownerCh.file(f)).toBeNull();
});

test("the cli reads a local file with its type, refuses a folder, an empty file and one over 25 MB, and saves a received one as #N-name", () => {
  const doc = join(scratch, "notes.md");
  writeFileSync(doc, "# hi\n");
  const [read] = loadFiles([doc]);
  expect(read?.name).toBe("notes.md");
  expect(read?.mime).toMatch(/^text\/markdown/);
  expect(Buffer.from(read!.bytes).toString()).toBe("# hi\n");
  const folder = join(scratch, "folder");
  mkdirSync(folder);
  expect(() => loadFiles([folder])).toThrow(/not a file/);
  const empty = join(scratch, "empty.bin");
  writeFileSync(empty, "");
  expect(() => loadFiles([empty])).toThrow(/is empty/);
  const huge = join(scratch, "huge.bin");
  writeFileSync(huge, new Uint8Array(MAX_FILE_BYTES + 1));
  expect(() => loadFiles([huge])).toThrow(/at most 25 MB/);
  const [path] = saveFiles(42, [{ name: "a report (final).pdf", bytes: new Uint8Array([1, 2, 3]) }], join(scratch, "out"));
  expect(path).toBe(join(scratch, "out", "#42-a_report__final_.pdf"));
  expect([...readFileSync(path!)]).toEqual([1, 2, 3]);
  expect(statSync(path!).mode & 0o777).toBe(0o600);
});

test("a message with a file shows it as a marker beside the text", async () => {
  const f = await memberCh.putFile("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", noise(FILE_PIECE_BYTES + 1));
  const seq = await memberCh.send("the deck", { files: [f] });
  const got = (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq)!;
  expect(formatMessage(got)).toContain("the deck [file: slides.pptx (1.0MB)]");
});

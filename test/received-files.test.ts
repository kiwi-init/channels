import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { run } from "@kiwi/core/client/relay.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { formatShown } from "@kiwi/core/format.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold } from "@kiwi/core/state.ts";
import { anydocWasmPath, documentFormat, keepFiles } from "../src/received-files.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-received-relay-"));
const kiwiHome = mkdtempSync(join(tmpdir(), "kiwi-received-home-"));
const homeBefore = process.env.KIWI_HOME;
process.env.KIWI_HOME = kiwiHome;
const wasm = new Uint8Array(readFileSync(join(import.meta.dir, "../node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm")));
const fixture = (name: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/files", name)));
const realFetch = globalThis.fetch;
const asked: string[] = [];
let mirror: (url: string) => Response = () => Response.error();
const stub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://cdn.jsdelivr.net/") && !url.startsWith("https://unpkg.com/")) return realFetch(input, init);
  asked.push(url);
  return Promise.resolve(mirror(url));
};
globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect });

let server: ReturnType<typeof startRelay>;
let ownerCh: Channel;
let memberCh: Channel;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
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
  globalThis.fetch = realFetch;
  if (homeBefore === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = homeBefore;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(kiwiHome, { recursive: true, force: true });
});

async function received(name: string, mime: string, bytes: Uint8Array<ArrayBuffer>): Promise<Message> {
  const f = await memberCh.putFile(name, mime, bytes);
  const seq = await memberCh.send(`here is ${name}`, { files: [f] });
  return (await ownerCh.history(seq - 1)).messages.find((m) => m.seq === seq)!;
}

const keep = (m: Message, dir: string) => run(keepFiles(ownerCh, m, dir));

test("documents are known by their extension, and other files are not", () => {
  expect(documentFormat("Plan.DOCX")).toBe("docx");
  expect(documentFormat("deck.pptx")).toBe("pptx");
  expect(documentFormat("numbers.csv")).toBe("csv");
  expect(documentFormat("photo.png")).toBeNull();
  expect(documentFormat("notes")).toBeNull();
});

test("without a converter that matches its pinned hash, the file is saved and keeps no Markdown copy", async () => {
  const tampered = wasm.slice();
  tampered[tampered.length - 1] = tampered.at(-1)! ^ 1;
  mkdirSync(join(kiwiHome, "cache"), { recursive: true });
  writeFileSync(anydocWasmPath(), tampered);
  mirror = (url) => (url.startsWith("https://cdn.jsdelivr.net/") ? new Response(tampered) : new Response("down", { status: 503 }));
  const m = await received("plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fixture("plan.docx"));
  const dir = join(kiwiHome, "first");
  const kept = await keep(m, dir);
  expect(kept.saved).toEqual([join(dir, `#${m.seq}-plan.docx`)]);
  expect(kept.markdown).toEqual([]);
  expect(asked).toHaveLength(2);
  expect(Buffer.from(readFileSync(anydocWasmPath())).equals(Buffer.from(tampered))).toBe(true);
});

test("the converter comes from the next mirror once, is checked and cached, and a document gets a Markdown copy beside it", async () => {
  mirror = (url) => (url.startsWith("https://unpkg.com/") ? new Response(wasm) : new Response("down", { status: 503 }));
  asked.length = 0;
  const m = await received("plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fixture("plan.docx"));
  const dir = join(kiwiHome, "second");
  const kept = await keep(m, dir);
  const md = join(dir, `#${m.seq}-plan.docx.md`);
  expect(kept).toEqual({ saved: [join(dir, `#${m.seq}-plan.docx`)], markdown: [md] });
  expect(readFileSync(md, "utf8")).toContain("Ship files to every channel.");
  expect(statSync(md).mode & 0o777).toBe(0o600);
  expect(asked).toEqual(["https://cdn.jsdelivr.net/npm/@firecrawl/anydoc-wasm@0.2.4/anydoc_wasm_bg.wasm", "https://unpkg.com/@firecrawl/anydoc-wasm@0.2.4/anydoc_wasm_bg.wasm"]);
  expect(Buffer.from(readFileSync(anydocWasmPath())).equals(Buffer.from(wasm))).toBe(true);
  const shown = formatShown(m, [m], fold([m], []), [], undefined, false, kept);
  expect(shown).toContain(`  as Markdown: ${md}`);
});

test("a pdf and a csv read as Markdown; an image and a damaged pdf are saved with no copy", async () => {
  const dir = join(kiwiHome, "third");
  const pdf = await keep(await received("invoice.pdf", "application/pdf", fixture("invoice.pdf")), dir);
  expect(readFileSync(pdf.markdown[0]!, "utf8")).toContain("Invoice 42: total 1200 euros");
  const csv = await keep(await received("table.csv", "text/csv", new TextEncoder().encode("name,count\nkiwi,3\n")), dir);
  expect(readFileSync(csv.markdown[0]!, "utf8")).toContain("| kiwi | 3 |");
  const png = await keep(await received("photo.png", "image/png", new Uint8Array([137, 80, 78, 71, 1, 2, 3])), dir);
  expect([png.saved.length, png.markdown.length]).toEqual([1, 0]);
  const broken = await keep(await received("broken.pdf", "application/pdf", new TextEncoder().encode("not a pdf at all")), dir);
  expect([broken.saved.length, broken.markdown.length]).toEqual([1, 0]);
  expect(existsSync(`${broken.saved[0]}.md`)).toBe(false);
});

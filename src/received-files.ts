import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import * as Effect from "effect/Effect";
import { initSync, toMarkdownBytes, type Format } from "@firecrawl/anydoc-wasm";
import type { Channel } from "@kiwi/core/client.ts";
import type { FileAttachment, ImageAttachment, Message } from "@kiwi/core/protocol.ts";
import { caseRuleOf, planNames, saveNamed, type CaseRule } from "./attach.ts";
import { home } from "./config.ts";

export const ANYDOC_VERSION = "0.2.4";
export const ANYDOC_WASM_SHA256 = "9f37cd53b17bf4028ac5ae6a2ac4cf625e9c53be511797168780bab495de1a9e";
export const ANYDOC_ASSET = `anydoc-${ANYDOC_VERSION}.wasm`;
const ASSETS_RELEASE = "kiwi-assets";
const SOURCES = [
  `https://github.com/kiwi-init/channels/releases/download/${ASSETS_RELEASE}/${ANYDOC_ASSET}`,
  `https://cdn.jsdelivr.net/npm/@firecrawl/anydoc-wasm@${ANYDOC_VERSION}/anydoc_wasm_bg.wasm`,
  `https://unpkg.com/@firecrawl/anydoc-wasm@${ANYDOC_VERSION}/anydoc_wasm_bg.wasm`,
];
const FETCH_MS = 60_000;

const FORMATS: Readonly<Record<string, Format>> = {
  ".doc": "doc",
  ".docx": "docx",
  ".odt": "odt",
  ".pdf": "pdf",
  ".ppt": "ppt",
  ".pptx": "pptx",
  ".rtf": "rtf",
  ".epub": "epub",
  ".xlsx": "xlsx",
  ".ods": "ods",
  ".odp": "odp",
  ".csv": "csv",
};

export function documentFormat(name: string): Format | null {
  return FORMATS[extname(name).toLowerCase()] ?? null;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function anydocWasmPath(): string {
  return join(home(), "cache", ANYDOC_ASSET);
}

function cached(): Uint8Array | null {
  const file = anydocWasmPath();
  if (!existsSync(file)) return null;
  const bytes = new Uint8Array(readFileSync(file));
  return sha256(bytes) === ANYDOC_WASM_SHA256 ? bytes : null;
}

async function fetched(): Promise<Uint8Array | null> {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (sha256(bytes) !== ANYDOC_WASM_SHA256) continue;
      const file = anydocWasmPath();
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, file);
      return bytes;
    } catch {
      // This mirror is down, slow or unwritable here: try the next one, and without any the document keeps no Markdown copy.
    }
  }
  return null;
}

let ready: Promise<boolean> | null = null;

async function load(): Promise<boolean> {
  const bytes = cached() ?? (await fetched());
  if (!bytes) return false;
  initSync({ module: bytes });
  return true;
}

function anydocReady(): Promise<boolean> {
  ready ??= load()
    .catch(() => false)
    .then((ok) => {
      if (!ok) ready = null;
      return ok;
    });
  return ready;
}

export function messagePlan(m: Pick<Message, "seq" | "imgs" | "files">, rule: CaseRule) {
  const planned = planNames(
    m.seq,
    [
      ...(m.imgs ?? []).map((img) => ({ kind: "image" as const, img, name: img.name, fallback: "image" as const, markdown: false })),
      ...(m.files ?? []).map((file) => ({ kind: "file" as const, file, name: file.name, fallback: "file" as const, markdown: documentFormat(file.name) !== null })),
    ],
    rule,
  );
  return {
    imgs: planned.flatMap((p) => (p.kind === "image" ? [{ img: p.img, saveAs: p.saveAs }] : [])),
    files: planned.flatMap((p) => (p.kind === "file" ? [{ file: p.file, saveAs: p.saveAs }] : [])),
  };
}

const fetchFiles = (ch: Channel, files: FileAttachment[]) => Effect.forEach(files, (f) => ch.fx.file(f).pipe(Effect.orElseSucceed(() => null)), { concurrency: 2 });

const fetchImages = (ch: Channel, imgs: ImageAttachment[]) =>
  Effect.forEach(
    imgs,
    (img) =>
      ch.fx.images([img]).pipe(
        Effect.map((list) => list.map((got) => Buffer.from(got.data, "base64"))[0] ?? null),
        Effect.orElseSucceed(() => null),
      ),
    { concurrency: 4 },
  );

const arrived = <P extends { saveAs: string }>(plan: P[], bytes: (Uint8Array | null)[]) =>
  plan.flatMap((p, i) => {
    const got = bytes[i];
    return got ? [{ ...p, bytes: got }] : [];
  });

const writeFiles = (files: { file: FileAttachment; saveAs: string; bytes: Uint8Array }[], dir: string) =>
  Effect.gen(function* () {
    const saved = saveNamed(files, dir);
    const markdown: string[] = [];
    for (const f of files) {
      const md = yield* Effect.promise(() => markdownCopy(f.file.name, f.bytes));
      if (md === null) continue;
      const path = `${join(dir, f.saveAs)}.md`;
      writeFileSync(path, md, { mode: 0o600 });
      markdown.push(path);
    }
    return { saved, markdown };
  });

export const saveMessage = (ch: Channel, m: Message, dir: string) =>
  Effect.gen(function* () {
    const imgBytes = yield* fetchImages(ch, m.imgs ?? []);
    const fileBytes = yield* fetchFiles(ch, m.files ?? []);
    if (![...imgBytes, ...fileBytes].some((b) => b)) return { images: [] as string[], kept: { saved: [] as string[], markdown: [] as string[] } };
    const plan = messagePlan(m, caseRuleOf(dir));
    const images = arrived(plan.imgs, imgBytes);
    const saved = images.length ? saveNamed(images, dir) : [];
    const files = arrived(plan.files, fileBytes);
    const kept = files.length ? yield* writeFiles(files, dir) : { saved: [] as string[], markdown: [] as string[] };
    return { images: saved, kept };
  });

async function markdownCopy(name: string, bytes: Uint8Array): Promise<string | null> {
  const format = documentFormat(name);
  if (!format || !(await anydocReady())) return null;
  try {
    const md = toMarkdownBytes(bytes, format);
    return md.trim() ? md : null;
  } catch {
    // anydoc couldn't read this document (damaged, encrypted, or only scanned pages): the file itself is still saved.
    return null;
  }
}

import { b64url, freshKeyPair, fromB64url } from "./crypto.ts";

export const PIPE_FRAME_MAX = 64 * 1024;
export const PIPE_TEXT_MAX = 8_192;
const SEQ_BYTES = 4;
const SEQ_LAST = 0xffff_ffff;
const TAG_BYTES = 16;
const INFO = "kiwi-shell-pipe";
const X25519 = { name: "X25519" } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type PipeSide = "app" | "computer";

type PipeMessage = { out: string } | { ended: true } | { keys: string } | { size: { cols: number; rows: number } } | { close: true };

export interface ShellKey {
  epk: string;
  secret: CryptoKey;
}

export interface PipeBinding {
  pipe: string;
  ask: string;
  machine: string;
  app: string;
  computer: string;
}

export interface Pipe {
  seal(msg: PipeMessage): Promise<Uint8Array<ArrayBuffer>>;
  open(frame: Uint8Array): Promise<PipeMessage | null>;
  readonly dead: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const size = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 1_000;

export async function newShellKey(): Promise<ShellKey> {
  const pair = await freshKeyPair(X25519, ["deriveBits"]);
  return { epk: b64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)), secret: pair.privateKey };
}

const other = (side: PipeSide): PipeSide => (side === "app" ? "computer" : "app");

function readMessage(text: string, from: PipeSide): PipeMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // A frame that opened but isn't JSON carries nothing to act on.
    return null;
  }
  if (!isRecord(v) || Object.keys(v).length !== 1) return null;
  if (from === "computer") {
    if (typeof v.out === "string" && v.out.length <= PIPE_TEXT_MAX) return { out: v.out };
    if (v.ended === true) return { ended: true };
    return null;
  }
  if (typeof v.keys === "string" && v.keys.length > 0 && v.keys.length <= PIPE_TEXT_MAX) return { keys: v.keys };
  if (v.close === true) return { close: true };
  const s = v.size;
  if (isRecord(s) && Object.keys(s).length === 2 && size(s.cols) && size(s.rows)) return { size: { cols: s.cols, rows: s.rows } };
  return null;
}

const sent = (msg: PipeMessage): PipeSide => ("out" in msg || "ended" in msg ? "computer" : "app");

async function directionKey(base: CryptoKey, b: PipeBinding, from: PipeSide): Promise<CryptoKey> {
  const info = [INFO, `${from}>${other(from)}`, b.pipe, b.ask, b.machine, b.app, b.computer].join("\n");
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function nonce(from: PipeSide, seq: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  iv[0] = from === "app" ? 0 : 1;
  new DataView(iv.buffer).setUint32(8, seq);
  return iv;
}

export async function openPipe(mine: ShellKey, side: PipeSide, b: PipeBinding): Promise<Pipe> {
  const theirs = side === "app" ? b.computer : b.app;
  const ours = side === "app" ? b.app : b.computer;
  if (ours !== mine.epk) throw new Error("this shell key isn't the one the pipe was opened with");
  const pub = await crypto.subtle.importKey("raw", fromB64url(theirs), X25519, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: pub }, mine.secret, 256);
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const sendKey = await directionKey(base, b, side);
  const recvKey = await directionKey(base, b, other(side));
  const ad = (from: PipeSide): Uint8Array<ArrayBuffer> => enc.encode(`${b.pipe}\n${from}`);
  let out = 0;
  let next = 0;
  let dead = false;
  let sealing: Promise<unknown> = Promise.resolve();
  let opening: Promise<unknown> = Promise.resolve();

  const seal = async (msg: PipeMessage, seq: number): Promise<Uint8Array<ArrayBuffer>> => {
    const body = enc.encode(JSON.stringify(msg));
    if (SEQ_BYTES + body.length + TAG_BYTES > PIPE_FRAME_MAX) throw new Error(`a pipe frame is at most ${PIPE_FRAME_MAX} bytes`);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(side, seq), additionalData: ad(side) }, sendKey, body));
    const frame = new Uint8Array(SEQ_BYTES + ct.length);
    new DataView(frame.buffer).setUint32(0, seq);
    frame.set(ct, SEQ_BYTES);
    return frame;
  };

  const open = async (frame: Uint8Array): Promise<PipeMessage | null> => {
    if (dead) return null;
    const seq = frame.length >= SEQ_BYTES + TAG_BYTES && frame.length <= PIPE_FRAME_MAX ? new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0) : -1;
    if (seq !== next) {
      dead = true;
      return null;
    }
    const from = other(side);
    let text: string;
    try {
      text = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(from, seq), additionalData: ad(from) }, recvKey, frame.slice(SEQ_BYTES)));
    } catch {
      // A frame that doesn't open was changed or forged on the way: the pipe can't be trusted after it.
      dead = true;
      return null;
    }
    const msg = readMessage(text, from);
    if (!msg || seq === SEQ_LAST) {
      dead = true;
      return msg;
    }
    next = seq + 1;
    return msg;
  };

  return {
    get dead() {
      return dead;
    },
    seal(msg) {
      if (sent(msg) !== side) return Promise.reject(new Error(`the ${side} doesn't send that`));
      const text = "out" in msg ? msg.out : "keys" in msg ? msg.keys : "";
      if (text.length > PIPE_TEXT_MAX) return Promise.reject(new Error(`a pipe frame carries at most ${PIPE_TEXT_MAX} characters: split it with textChunks`));
      const done = sealing.then(async () => {
        if (out > SEQ_LAST) throw new Error("this pipe sent all the frames it can");
        const frame = await seal(msg, out);
        out++;
        return frame;
      });
      sealing = done.catch(() => undefined);
      return done;
    },
    open(frame) {
      const done = opening.then(() => open(frame));
      opening = done.catch(() => undefined);
      return done;
    },
  };
}

export function textChunks(text: string): string[] {
  const chunks: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + PIPE_TEXT_MAX, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(text.slice(at, end));
    at = end;
  }
  return chunks;
}

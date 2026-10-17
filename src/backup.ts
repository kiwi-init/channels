import { scryptAsync } from "@noble/hashes/scrypt.js";

import { WORDS } from "./backup-words.ts";
import { b64url, fromB64url, openBytes, sealBytes } from "./crypto.ts";

export const BACKUP_MAX_BYTES = 256 * 1024;
export const BACKUP_WORDS = 6;
export const BACKUP_KDF = { N: 2 ** 16, r: 8, p: 1 } as const;

export interface BackupEnvelope {
  v: 1;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  ct: string;
}

export class WrongPassphrase extends Error {
  constructor() {
    super("that passphrase does not open this backup");
    this.name = "WrongPassphrase";
  }
}

const enc = new TextEncoder();

function below(limit: number): number {
  const span = 2 ** 32 - (2 ** 32 % limit);
  const one = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(one);
    if (one[0]! < span) return one[0]! % limit;
  }
}

export function generatePassphrase(words: number = BACKUP_WORDS): string {
  return Array.from({ length: words }, () => WORDS[below(WORDS.length)]!).join(" ");
}

export function normalizePassphrase(text: string): string {
  return text
    .toLowerCase()
    .split(/[\s\-_,.]+/)
    .filter(Boolean)
    .join(" ");
}

export function passphraseProblem(text: string): string | null {
  const words = normalizePassphrase(text).split(" ").filter(Boolean);
  const chars = words.join(" ").length;
  return words.length >= 5 || chars >= 20
    ? null
    : "Use the six words the app gave you, or at least five words or twenty characters of your own.";
}

const aad = (env: Pick<BackupEnvelope, "v" | "kdf" | "N" | "r" | "p" | "salt">): string =>
  `kiwi-backup\n${env.v}\n${env.kdf}\n${env.N}\n${env.r}\n${env.p}\n${env.salt}`;

async function keyFor(
  passphrase: string,
  salt: Uint8Array,
  params: { N: number; r: number; p: number },
): Promise<string> {
  const raw = await scryptAsync(enc.encode(normalizePassphrase(passphrase)), salt, {
    ...params,
    dkLen: 32,
    maxmem: 160 * params.N * params.r,
  });
  return b64url(raw);
}

export async function sealBackup(
  passphrase: string,
  payload: object,
  params: { N: number; r: number; p: number } = BACKUP_KDF,
): Promise<BackupEnvelope> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const head = { v: 1 as const, kdf: "scrypt" as const, ...params, salt: b64url(salt) };
  const { iv, ct } = await sealBytes(
    await keyFor(passphrase, salt, params),
    new Uint8Array(enc.encode(JSON.stringify(payload))),
    aad(head),
  );
  const env: BackupEnvelope = { ...head, iv, ct };
  if (enc.encode(JSON.stringify(env)).length > BACKUP_MAX_BYTES)
    throw new Error("the backup is too large");
  return env;
}

export function readEnvelope(value: unknown): BackupEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  const ok =
    e.v === 1 &&
    e.kdf === "scrypt" &&
    typeof e.N === "number" &&
    typeof e.r === "number" &&
    typeof e.p === "number" &&
    typeof e.salt === "string" &&
    typeof e.iv === "string" &&
    typeof e.ct === "string";
  if (!ok) return null;
  const env = e as unknown as BackupEnvelope;
  const sane =
    Number.isInteger(env.N) &&
    env.N >= 2 ** 14 &&
    env.N <= 2 ** 20 &&
    (env.N & (env.N - 1)) === 0 &&
    env.r === 8 &&
    env.p === 1;
  return sane ? env : null;
}

export async function openBackup<T extends object>(
  passphrase: string,
  env: BackupEnvelope,
  check: (v: unknown) => v is T,
): Promise<T> {
  const key = await keyFor(passphrase, fromB64url(env.salt), env);
  const plain = await openBytes(key, env.iv, env.ct, aad(env));
  if (!plain) throw new WrongPassphrase();
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (!check(parsed)) throw new Error("this backup is not one Kiwi can read");
  return parsed;
}

export class BackupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

async function call(
  relay: string,
  token: string,
  method: "GET" | "PUT" | "DELETE",
  body?: object,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const res = await fetchImpl(`${relay}/v1/backup`, {
    method,
    headers: { "x-human-token": token, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const said = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new BackupError(res.status, said?.error ?? `the relay answered ${res.status}`);
  }
  return res;
}

export async function putBackup(
  relay: string,
  token: string,
  envelope: BackupEnvelope,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await call(relay, token, "PUT", { envelope }, fetchImpl);
}

export async function getBackup(
  relay: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<{ envelope: BackupEnvelope; at: number } | null> {
  try {
    const body = (await (await call(relay, token, "GET", undefined, fetchImpl)).json()) as {
      envelope?: unknown;
      at?: unknown;
    };
    const envelope = readEnvelope(body.envelope);
    return envelope && typeof body.at === "number" ? { envelope, at: body.at } : null;
  } catch (e) {
    if (e instanceof BackupError && e.status === 404) return null;
    throw e;
  }
}

export async function deleteBackup(
  relay: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await call(relay, token, "DELETE", undefined, fetchImpl);
}

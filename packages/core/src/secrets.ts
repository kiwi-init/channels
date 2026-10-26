import { b64url, openFrom, sealTo, toBase64 } from "./crypto.ts";
import { signText, verifyText, type Identity } from "./identity.ts";
import { inlineText } from "./membership.ts";

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SECRET_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const MIN_SECRET_VALUE = 8;
const MAX_SECRET_VALUE = 8_192;
const MAX_SECRET_NOTE = 200;
export const MAX_SECRETS = 64;
export const MAX_SECRET_BOX = 16_384;
export const MAX_SECRET_BYTES = 4 * 1024 * 1024;

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const SHELL_NAMES = new Set(["PATH", "HOME", "SHELL", "USER", "LOGNAME", "PWD", "OLDPWD", "TMPDIR", "TERM", "IFS", "ENV", "BASH_ENV"]);
const SHELL_PREFIXES = ["KIWI_", "LD_", "DYLD_"];

export interface SecretPlain {
  v: 1;
  room: string;
  id: string;
  to: string;
  name: string;
  value: string;
  note?: string;
  rev: number;
  at: number;
  grants?: string[];
  had?: string[];
}

export interface SecretRow {
  id: string;
  box: string;
  at: number;
}

export interface Secret {
  id: string;
  name: string;
  value: string;
  note: string | null;
  rev: number;
  at: number;
}

export interface SecretView {
  id: string;
  name: string;
  note: string | null;
  rev: number;
  at: number;
  grants: string[];
  had: string[];
}

export function newSecretId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function secretNameProblem(name: string): string | null {
  if (!SECRET_NAME_RE.test(name)) return "a secret's name is what a command reads it as: capital letters, digits and _, starting with a letter, at most 64 (STRIPE_KEY)";
  if (SHELL_NAMES.has(name) || SHELL_PREFIXES.some((p) => name.startsWith(p))) return `${name} is a name the agent's shell or kiwi itself relies on: pick another`;
  return null;
}

export function secretValueProblem(value: string): string | null {
  if (value.length < MIN_SECRET_VALUE) return `a secret is at least ${MIN_SECRET_VALUE} characters: a shorter one can't be told apart from ordinary text, so Kiwi couldn't keep it out of messages`;
  if (value.length > MAX_SECRET_VALUE) return `a secret is at most ${MAX_SECRET_VALUE.toLocaleString("en")} characters`;
  if (value.includes("\0")) return "a secret can't hold a NUL character: a command's environment can't carry one";
  return null;
}

export function secretNote(note: string | null | undefined): string | null {
  return inlineText(note ?? "", MAX_SECRET_NOTE) || null;
}

const boxInfo = (room: string, id: string, pk: string) => `kiwi-secret\n${room}\n${id}\n${pk}`;
const statement = (room: string, id: string, pk: string, box: string) => `kiwi-secret\n${room}\n${id}\n${pk}\n${box}`;

export async function sealSecret(owner: Identity, to: { pk: string; xpk: string }, plain: SecretPlain): Promise<string> {
  const box = await sealTo(to.xpk, JSON.stringify(plain), boxInfo(plain.room, plain.id, to.pk));
  return JSON.stringify({ box, sig: await signText(owner, statement(plain.room, plain.id, to.pk, box)) });
}

const keys = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 1_000 && v.every((k) => typeof k === "string" && KEY_RE.test(k));
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function readPlain(text: string): SecretPlain | null {
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    // Sealed by the owner's key but not JSON: no secret can be read out of it.
    return null;
  }
  if (o.v !== 1 || typeof o.room !== "string" || typeof o.id !== "string" || typeof o.to !== "string") return null;
  if (typeof o.name !== "string" || secretNameProblem(o.name) || typeof o.value !== "string" || secretValueProblem(o.value)) return null;
  if (!count(o.rev) || !count(o.at)) return null;
  if (o.note !== undefined && (typeof o.note !== "string" || o.note.length > MAX_SECRET_NOTE)) return null;
  if ((o.grants !== undefined && !keys(o.grants)) || (o.had !== undefined && !keys(o.had))) return null;
  return {
    v: 1,
    room: o.room,
    id: o.id,
    to: o.to,
    name: o.name,
    value: o.value,
    ...(o.note ? { note: o.note } : {}),
    rev: o.rev,
    at: o.at,
    ...(o.grants ? { grants: o.grants as string[] } : {}),
    ...(o.had ? { had: o.had as string[] } : {}),
  };
}

export async function openSecret(me: Identity, room: string, ownerPk: string, row: SecretRow): Promise<SecretPlain | null> {
  if (!me.xsk || !SECRET_ID_RE.test(row.id) || typeof row.box !== "string") return null;
  let wrapped: { box?: unknown; sig?: unknown };
  try {
    wrapped = JSON.parse(row.box) as { box?: unknown; sig?: unknown };
  } catch {
    // Not the owner's {box, sig}: whatever the relay stored there is no secret.
    return null;
  }
  if (!wrapped || typeof wrapped.box !== "string" || typeof wrapped.sig !== "string") return null;
  if (!(await verifyText(ownerPk, wrapped.sig, statement(room, row.id, me.pk, wrapped.box)))) return null;
  const text = await openFrom(me.xsk, wrapped.box, boxInfo(room, row.id, me.pk));
  const plain = text === null ? null : readPlain(text);
  return plain && plain.room === room && plain.id === row.id && plain.to === me.pk ? plain : null;
}

const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Runs(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let k = 0; k < 3; k++) {
    const shifted = new Uint8Array(k + bytes.length);
    shifted.set(bytes, k);
    out.push(toBase64(shifted).slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6)));
  }
  return out;
}

export function secretNeedles(value: string): string[] {
  const forms = new Set<string>();
  const add = (s: string) => {
    if (s.length >= MIN_SECRET_VALUE) forms.add(s);
  };
  for (const v of new Set([value, value.trim()])) {
    add(v);
    add(JSON.stringify(v).slice(1, -1));
    add(encodeURIComponent(v));
    const bytes = enc.encode(v);
    add(hex(bytes));
    add(hex(bytes).toUpperCase());
    for (const run of base64Runs(bytes)) {
      add(run);
      add(run.replace(/\+/g, "-").replace(/\//g, "_"));
    }
    try {
      const url = new URL(v);
      if (url.password) {
        add(url.password);
        add(decodeURIComponent(url.password));
      }
    } catch {
      // Not a URL, so there is no password inside it to watch for on its own.
    }
  }
  for (const part of value.split(/\\n|[\s"',:;{}[\]]+/)) if (part.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(part) && /\d/.test(part) && /[A-Za-z]/.test(part)) add(part);
  return [...forms].sort((a, b) => b.length - a.length);
}

export class SecretGuard {
  private readonly needles: { name: string; needle: string }[];

  constructor(secrets: readonly Pick<Secret, "name" | "value">[]) {
    this.needles = secrets.flatMap((s) => secretNeedles(s.value).map((needle) => ({ name: s.name, needle }))).sort((a, b) => b.needle.length - a.needle.length);
  }

  get empty(): boolean {
    return this.needles.length === 0;
  }

  leak(text: string): string | null {
    for (const n of this.needles) if (text.includes(n.needle)) return n.name;
    return null;
  }
}

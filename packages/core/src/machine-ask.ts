import { b64url, openFrom, sealTo } from "./crypto.ts";
import { isKnownHarness, type KnownHarness } from "./harnesses.ts";
import { speaksForPerson, type DeviceList } from "./devices.ts";
import { sign, verify, type Identity } from "./identity.ts";
import { joinLineRefusal } from "./join-line.ts";
import { CHOICE_KEYS, readLaunchChoices, type LaunchChoices } from "./launch-options.ts";

const MACHINE_VERBS = ["harnesses", "folders", "launch", "unpair", "settings", "shell", "shell-tabs", "shell-close"] as const;
export type MachineVerb = (typeof MACHINE_VERBS)[number];

export const ASK_MAX_BYTES = 4_096;
export const ASK_FRESH_MS = 2 * 60_000;
const ASK_INFO = "kiwi-machine-ask";
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export interface MachineAsk {
  kind: "kiwi-machine-ask";
  v: 1;
  machine: string;
  verb: MachineVerb;
  args: Record<string, unknown>;
  id: string;
  at: number;
  reply: string;
}

export interface MachineAnswer {
  kind: "kiwi-machine-answer";
  v: 1;
  id: string;
  result: unknown;
  pk: string;
  sig: string;
}

export type AskRefusal = "too-big" | "unsealed" | "malformed" | "unsigned" | "not-yours" | "stale" | "replayed";

const isVerb = (v: unknown): v is MachineVerb => typeof v === "string" && (MACHINE_VERBS as readonly string[]).includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function newAskId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function makeAsk(
  person: Identity,
  machine: { pk: string; xpk: string },
  ask: { verb: MachineVerb; args: Record<string, unknown>; reply: string; id?: string },
  now = Date.now(),
): Promise<{ box: string; id: string }> {
  const id = ask.id ?? newAskId();
  if (!ID_RE.test(id)) throw new Error("an ask's id is 8 to 64 of A-Z a-z 0-9 _ -");
  if (!SECRET_RE.test(ask.reply)) throw new Error("an ask's reply is a mailbox secret");
  const body: MachineAsk = { kind: "kiwi-machine-ask", v: 1, machine: machine.pk, verb: ask.verb, args: ask.args, id, at: now, reply: ask.reply };
  const box = await sealTo(machine.xpk, JSON.stringify(await sign(person, body)), ASK_INFO);
  if (box.length > ASK_MAX_BYTES) throw new Error(`an ask is at most ${ASK_MAX_BYTES} bytes sealed`);
  return { box, id };
}

function readAskBody(x: unknown): (MachineAsk & { pk: string; sig: string }) | null {
  if (!isRecord(x)) return null;
  const { kind, v, machine, verb, args, id, at, reply, pk, sig } = x;
  if (kind !== "kiwi-machine-ask" || v !== 1 || typeof machine !== "string" || !isVerb(verb) || !isRecord(args)) return null;
  if (typeof id !== "string" || !ID_RE.test(id) || typeof at !== "number" || !Number.isFinite(at) || typeof reply !== "string" || !SECRET_RE.test(reply)) return null;
  if (typeof pk !== "string" || typeof sig !== "string" || Object.keys(x).length !== 10) return null;
  return { kind, v, machine, verb, args, id, at, reply, pk, sig };
}

export async function readAsk(
  machine: Identity,
  box: string,
  expect: { person: string; list?: DeviceList | null; now?: number; claim: (id: string) => boolean },
): Promise<{ ok: true; ask: MachineAsk } | { ok: false; why: AskRefusal }> {
  if (box.length > ASK_MAX_BYTES) return { ok: false, why: "too-big" };
  const opened = machine.xsk ? await openFrom(machine.xsk, box, ASK_INFO) : null;
  if (opened === null) return { ok: false, why: "unsealed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(opened);
  } catch {
    // Sealed to us but not JSON: nothing to trust in it.
    return { ok: false, why: "malformed" };
  }
  const signed = readAskBody(parsed);
  if (!signed) return { ok: false, why: "malformed" };
  if (!(await verify(signed))) return { ok: false, why: "unsigned" };
  const now = expect.now ?? Date.now();
  const list = expect.list?.person === expect.person ? expect.list : null;
  const yours = list ? speaksForPerson(list, signed.pk, now) : signed.pk === expect.person;
  if (!yours || signed.machine !== machine.pk) return { ok: false, why: "not-yours" };
  if (Math.abs(now - signed.at) > ASK_FRESH_MS) return { ok: false, why: "stale" };
  if (!expect.claim(signed.id)) return { ok: false, why: "replayed" };
  return { ok: true, ask: { kind: signed.kind, v: signed.v, machine: signed.machine, verb: signed.verb, args: signed.args, id: signed.id, at: signed.at, reply: signed.reply } };
}

export function signAnswer(machine: Identity, id: string, result: unknown): Promise<MachineAnswer> {
  return sign(machine, { kind: "kiwi-machine-answer" as const, v: 1 as const, id, result });
}

export async function readAnswer(x: unknown, expect: { machine: string; id: string }): Promise<{ result: unknown } | null> {
  if (!isRecord(x) || x.kind !== "kiwi-machine-answer" || x.v !== 1 || x.id !== expect.id || x.pk !== expect.machine || !("result" in x)) return null;
  if (Object.keys(x).length !== 6 || !(await verify(x))) return null;
  return { result: x.result };
}

export type MachineArgs =
  | { verb: "harnesses" }
  | { verb: "unpair" }
  | { verb: "settings" }
  | { verb: "folders"; room?: string }
  | { verb: "launch"; launch: { harness: KnownHarness; folder: string; code: string; relay?: string; nick?: string; persona?: string } & LaunchChoices }
  | { verb: "shell"; shell: ShellAsk }
  | { verb: "shell-tabs" }
  | { verb: "shell-close"; pane: string };

interface ShellAsk {
  want: string;
  cols: number;
  rows: number;
  pipe: string;
  epk: string;
}

export interface ShellOpened {
  epk: string;
  pane: string;
  window: string;
  cols: number;
  rows: number;
}

export interface ShellTab {
  pane: string;
  label: string;
}

const ROOM_RE = /^[0-9a-f]{32}$/;
const PANE_RE = /^%\d{1,10}$/;
const PIPE_RE = /^[A-Za-z0-9_-]{22}$/;
const EPK_RE = /^[A-Za-z0-9_-]{43}$/;
const SHELL_KEYS = ["want", "cols", "rows", "pipe", "epk"];
const LABEL_MAX = 200;
const TABS_MAX = 64;

const isPane = (v: unknown): v is string => typeof v === "string" && PANE_RE.test(v);

const shellSize = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 1_000;

function readShellAsk(args: Record<string, unknown>): ShellAsk | null {
  const keys = Object.keys(args);
  if (keys.length !== SHELL_KEYS.length || keys.some((k) => !SHELL_KEYS.includes(k))) return null;
  const { want, cols, rows, pipe, epk } = args;
  if (want !== "new" && want !== "any" && !isPane(want)) return null;
  if (!shellSize(cols) || !shellSize(rows) || typeof pipe !== "string" || !PIPE_RE.test(pipe) || typeof epk !== "string" || !EPK_RE.test(epk)) return null;
  return { want, cols, rows, pipe, epk };
}

export function readShellOpened(result: unknown): ShellOpened | null {
  if (!isRecord(result) || result.ok !== true) return null;
  const { epk, pane, window, cols, rows } = result;
  if (typeof epk !== "string" || !EPK_RE.test(epk) || !isPane(pane) || typeof window !== "string" || window.length > LABEL_MAX || !shellSize(cols) || !shellSize(rows)) return null;
  return { epk, pane, window, cols, rows };
}

export function readShellTabs(result: unknown): ShellTab[] | null {
  if (!isRecord(result) || result.ok !== true || !Array.isArray(result.tabs) || result.tabs.length > TABS_MAX) return null;
  const tabs = result.tabs.flatMap((t: unknown) => (isRecord(t) && isPane(t.pane) && typeof t.label === "string" && t.label.length <= LABEL_MAX ? [{ pane: t.pane, label: t.label }] : []));
  return tabs.length === result.tabs.length ? tabs : null;
}
const LAUNCH_KEYS = new Set<string>(["harness", "folder", "code", "relay", "nick", "persona", ...CHOICE_KEYS]);
const FOLDER_RE = /^\/[^\u0000-\u001f\u007f]{0,1023}$/;

const optionalText = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

export function readMachineArgs(ask: Pick<MachineAsk, "verb" | "args">): MachineArgs | null {
  const { verb, args } = ask;
  const keys = Object.keys(args);
  if (verb === "harnesses" || verb === "unpair" || verb === "settings" || verb === "shell-tabs") return keys.length ? null : { verb };
  if (verb === "shell") {
    const shell = readShellAsk(args);
    return shell ? { verb, shell } : null;
  }
  if (verb === "shell-close") return keys.length === 1 && isPane(args.pane) ? { verb, pane: args.pane } : null;
  if (verb === "folders") {
    if (keys.some((k) => k !== "room")) return null;
    if (args.room === undefined) return { verb };
    return typeof args.room === "string" && ROOM_RE.test(args.room) ? { verb, room: args.room } : null;
  }
  if (keys.some((k) => !LAUNCH_KEYS.has(k))) return null;
  const { harness, folder, code, relay, nick, persona } = args;
  if (!isKnownHarness(harness) || typeof folder !== "string" || !FOLDER_RE.test(folder) || typeof code !== "string") return null;
  if (!optionalText(relay) || !optionalText(nick) || !optionalText(persona)) return null;
  const choices = readLaunchChoices(args);
  const line = { code, ...(relay ? { relay } : {}), ...(nick ? { nick } : {}), ...(persona ? { persona } : {}) };
  return choices && joinLineRefusal(line) === null ? { verb, launch: { harness, folder, ...line, ...choices } } : null;
}

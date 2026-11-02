import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { readDeviceList, type DeviceList } from "@kiwi/core/devices.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { CHOICE_KEYS } from "@kiwi/core/launch-options.ts";
import { readAsk, readMachineArgs, signAnswer, type MachineArgs } from "@kiwi/core/machine-ask.ts";
import { openMailbox } from "@kiwi/core/mailbox.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { writePrivate } from "../config.ts";
import type { PairedMachine } from "./pair.ts";
import { appendRotated } from "./wake.ts";

const CLAIM_KEEP_MS = 15 * 60_000;
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const CHECK_MS = 2_000;

export interface InboxDeps {
  dir: string;
  machine: () => PairedMachine | null;
  run: (args: MachineArgs, id: string) => Promise<unknown>;
  unpaired: () => Promise<void>;
  listed: (links: unknown) => Promise<boolean>;
  settled?: () => Promise<unknown> | null;
  now?: () => number;
  checkMs?: number;
}

interface Delivered {
  id: string;
  box: string;
}

function claimer(file: string, now: () => number): (id: string) => boolean {
  return (id) => {
    let seen: Record<string, number> = {};
    try {
      seen = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    } catch {
      // No claims yet, or a file cut short: start from none.
    }
    const at = now();
    const kept = Object.fromEntries(Object.entries(seen).filter(([, t]) => typeof t === "number" && at - t < CLAIM_KEEP_MS));
    if (id in kept) return false;
    writePrivate(file, JSON.stringify({ ...kept, [id]: at }));
    return true;
  };
}

function machineUrl(m: PairedMachine, rest = ""): { url: string; path: string } {
  const path = `/v1/machine/${m.identity.pk}${rest}`;
  return { url: `${m.relay.replace(/\/+$/, "")}${path}`, path };
}

async function machineFetch(m: PairedMachine, method: string, rest = "", body?: unknown): Promise<Response> {
  const { url, path } = machineUrl(m, rest);
  const text = body === undefined ? "" : JSON.stringify(body);
  const token = await signRequest(m.identity, `machine:${m.identity.pk}`, method, path, text);
  return fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(text ? { "content-type": "application/json" } : {}) }, ...(text ? { body: text } : {}) });
}

const BOX_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function deliveredFrom(frame: string): Delivered | null {
  try {
    const v = JSON.parse(frame) as { box?: { id?: unknown; box?: unknown } };
    return typeof v.box?.id === "string" && BOX_ID_RE.test(v.box.id) && typeof v.box.box === "string" ? { id: v.box.id, box: v.box.box } : null;
  } catch {
    // A frame that isn't an ask: the relay sends nothing else.
    return null;
  }
}

type Paired = PairedMachine & { owner: string };

function pairedOf(m: PairedMachine): Paired | null {
  if (!m.relay) return null;
  if (m.device?.links.length) return { ...m, owner: m.device.person.pk };
  return m.cert && m.person ? { ...m, owner: m.person.pk } : null;
}

const pairedKey = (m: Paired): string => `${m.identity.pk}\u0000${m.relay}\u0000${m.owner}\u0000${m.device?.links.length ?? 0}\u0000${m.cert?.at ?? 0}`;

async function listOf(m: Paired): Promise<DeviceList | null> {
  if (!m.device?.links.length) return null;
  const read = await readDeviceList(m.device.links);
  return read.ok ? read.list : null;
}

async function register(m: Paired, listed: InboxDeps["listed"]): Promise<Response | null> {
  const byList = m.device?.links.length ? await machineFetch(m, "PUT", "", { links: m.device.links }).catch(() => null) : null;
  if (byList?.ok || !m.cert || m.cert.pk !== m.owner) return byList;
  const byCert = await machineFetch(m, "PUT", "", { cert: m.cert }).catch(() => null);
  if (byCert?.status !== 200 || m.device) return byCert;
  const links = ((await byCert.json().catch(() => null)) as { links?: unknown } | null)?.links;
  return (await listed(links)) ? null : byCert;
}

export async function forgetAtRelay(m: PairedMachine): Promise<void> {
  await machineFetch(m, "DELETE").catch(() => null);
}

export function startMachineInbox(deps: InboxDeps): { stop(): void; close(): void } {
  const now = deps.now ?? Date.now;
  const claim = claimer(join(deps.dir, "machine-asks.json"), now);
  const log = (row: string[]) => {
    try {
      appendRotated(join(deps.dir, "remote.log"), `${new Date(now()).toISOString()}\t${row.join("\t")}\n`);
    } catch {
      // The log only records what happened; failing to write it changes nothing.
    }
  };
  let ws: WebSocket | null = null;
  let held: string | null = null;
  let stopped = false;
  let retryAt = 0;
  let wait = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  const close = (): void => {
    const was = ws;
    ws = null;
    held = null;
    try {
      was?.close(1000, "unpaired");
    } catch {
      // Already closed.
    }
  };

  const handle = async (m: Paired, d: Delivered): Promise<void> => {
    const read = await readAsk(m.identity as Identity, d.box, { person: m.owner, list: await listOf(m), now: now(), claim }).catch(() => ({ ok: false as const, why: "malformed" as const }));
    if (!read.ok) {
      log(["refused", read.why, "", "", d.id]);
      await machineFetch(m, "DELETE", `/inbox/${d.id}`).catch(() => null);
      return;
    }
    const args = readMachineArgs(read.ask);
    const where = args?.verb === "launch" ? [args.launch.harness, args.launch.folder] : ["", ""];
    const options = args?.verb === "launch" ? CHOICE_KEYS.flatMap((k) => (args.launch[k] === undefined ? [] : [`${k}=${args.launch[k]}`])).join(" ") : "";
    const result = args
      ? await deps.run(args, read.ask.id).catch((err: unknown) => ({ ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) }))
      : { ok: false, why: "bad-args" };
    const ok = !!result && typeof result === "object" && (result as { ok?: unknown }).ok !== false;
    log([read.ask.verb, ok ? "done" : "refused", ...where, read.ask.id, ...(options ? [options] : [])]);
    try {
      const mailbox = await openMailbox(m.relay, read.ask.reply);
      await mailbox.put("b", await signAnswer(m.identity, read.ask.id, result));
    } catch {
      // The app stopped waiting, or its mailbox is gone: the ask still ran, and remote.log has it.
    }
    await machineFetch(m, "DELETE", `/inbox/${d.id}`).catch(() => null);
    if (args?.verb === "unpair") await deps.unpaired();
  };

  const connect = async (m: Paired): Promise<void> => {
    const key = pairedKey(m);
    held = key;
    await deps.settled?.();
    const registered = await register(m, deps.listed);
    if (!registered?.ok || stopped || held !== key) {
      held = null;
      retryAt = now() + wait;
      wait = Math.min(wait * 2, RETRY_MAX_MS);
      return;
    }
    const { url, path } = machineUrl(m, "/ws");
    const token = await signRequest(m.identity, `machine:${m.identity.pk}`, "GET", path);
    const socket = new WebSocket(url.replace(/^http/, "ws"), [WS_PROTOCOL, token]);
    ws = socket;
    socket.onopen = () => {
      wait = RETRY_FIRST_MS;
    };
    socket.onmessage = (e) => {
      const d = deliveredFrom(String(e.data));
      if (d) void handle(m, d);
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      held = null;
      retryAt = now() + wait;
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    };
  };

  const check = (): void => {
    if (stopped) return;
    const m = deps.machine();
    const paired = m ? pairedOf(m) : null;
    const key = paired ? pairedKey(paired) : null;
    if (held && held !== key) close();
    if (!paired || held || now() < retryAt) return;
    void connect(paired);
  };

  check();
  timer = setInterval(check, deps.checkMs ?? CHECK_MS);
  timer.unref?.();
  return {
    close,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      close();
    },
  };
}

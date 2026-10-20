import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import type { Identity } from "@kiwi/core/identity.ts";
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
  now?: () => number;
  checkMs?: number;
}

interface Delivered {
  id: string;
  box: string;
}

export function claimer(file: string, now: () => number): (id: string) => boolean {
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

  const handle = async (m: PairedMachine & { cert: NonNullable<PairedMachine["cert"]>; person: NonNullable<PairedMachine["person"]> }, d: Delivered): Promise<void> => {
    const read = await readAsk(m.identity as Identity, d.box, { person: m.person.pk, now: now(), claim });
    if (!read.ok) {
      log(["refused", read.why, "", "", d.id]);
      await machineFetch(m, "DELETE", `/inbox/${d.id}`).catch(() => null);
      return;
    }
    const args = readMachineArgs(read.ask);
    const where = args?.verb === "launch" ? [args.launch.harness, args.launch.folder] : ["", ""];
    const result = args
      ? await deps.run(args, read.ask.id).catch((err: unknown) => ({ ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) }))
      : { ok: false, why: "bad-args" };
    const ok = !!result && typeof result === "object" && (result as { ok?: unknown }).ok !== false;
    log([read.ask.verb, ok ? "done" : "refused", ...where, read.ask.id]);
    try {
      const mailbox = await openMailbox(m.relay, read.ask.reply);
      await mailbox.put("b", await signAnswer(m.identity, read.ask.id, result));
    } catch {
      // The app stopped waiting, or its mailbox is gone: the ask still ran, and remote.log has it.
    }
    await machineFetch(m, "DELETE", `/inbox/${d.id}`).catch(() => null);
    if (args?.verb === "unpair") await deps.unpaired();
  };

  const connect = async (m: PairedMachine & { cert: NonNullable<PairedMachine["cert"]>; person: NonNullable<PairedMachine["person"]> }): Promise<void> => {
    const key = `${m.identity.pk}\u0000${m.relay}\u0000${m.cert.at}`;
    held = key;
    const registered = await machineFetch(m, "PUT", "", { cert: m.cert }).catch(() => null);
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
      let d: Delivered | null = null;
      try {
        const v = JSON.parse(String(e.data)) as { box?: { id?: unknown; box?: unknown } };
        if (typeof v.box?.id === "string" && typeof v.box.box === "string") d = { id: v.box.id, box: v.box.box };
      } catch {
        // A frame that isn't an ask: the relay sends nothing else.
      }
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
    const paired = m?.cert && m.person && m.relay ? (m as PairedMachine & { cert: NonNullable<PairedMachine["cert"]>; person: NonNullable<PairedMachine["person"]> }) : null;
    const key = paired ? `${paired.identity.pk}\u0000${paired.relay}\u0000${paired.cert.at}` : null;
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

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import type { DaemonListener } from "../daemon/protocol.ts";
import { daemonListeners, ensureDaemon, holdListener, type HeldListener } from "../daemon/rpc.ts";
import { bindDirectory as bindSeat, bindingFor as seatFor, here, seatsFor as heldSeats, type Binding, type Listener, type SeatOptions } from "../seats.ts";

export function bindingFor(dir: string, opts: Omit<SeatOptions, "listeners"> = {}): Binding | null {
  return seatFor(dir, { ...opts, listeners: liveListeners });
}

export function seatsFor(dir: string, opts: Omit<SeatOptions, "listeners"> = {}): Binding[] {
  return heldSeats(dir, { ...opts, listeners: liveListeners });
}

export function bindDirectory(dir: string, b: Binding): boolean {
  return bindSeat(dir, b, isListening);
}

function listenerDir(): string {
  return join(home(), "listeners");
}

let fromDaemon: DaemonListener[] = [];
let signalsSet = false;

function heldFor(alias: string, as: string, kind: DaemonListener["kind"], session: string | null): Omit<DaemonListener, "at"> {
  const who = here();
  return { channel: alias, agent: as, kind, cwd: process.cwd(), harness: who.harness ?? null, session, pid: who.pid ?? null };
}

export async function refreshListeners(): Promise<void> {
  fromDaemon = await daemonListeners().catch(() => []);
}

export async function holdListening(alias: string, as: string): Promise<HeldListener> {
  const held = await holdListener(heldFor(alias, as, "listen", here().session ?? null));
  if (!signalsSet) {
    signalsSet = true;
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(0));
  }
  return held;
}

export async function holdSession(alias: string, as: string): Promise<HeldListener> {
  return holdListener(heldFor(alias, as, "session", here().session ?? null));
}

function legacySlotHeld(alias: string, as: string, session: string): boolean {
  const file = join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}`);
  try {
    const pid = Number(readFileSync(file, "utf8"));
    if (pid > 0 && alive(pid)) return true;
    rmSync(file, { force: true });
  } catch {}
  return false;
}

export async function takeListenSlot(alias: string, as: string, session: string): Promise<HeldListener | null> {
  if (legacySlotHeld(alias, as, session)) return null;
  const entry = heldFor(alias, as, "hook", session);
  let slot = await holdListener(entry);
  if (slot.held === null) {
    slot.close();
    await ensureDaemon().catch(() => null);
    slot = await holdListener(entry);
  }
  if (slot.held) return slot;
  slot.close();
  return null;
}

function liveRecords(): { name: string; rec: Record<string, unknown> }[] {
  const dir = listenerDir();
  if (!existsSync(dir)) return [];
  const out: { name: string; rec: Record<string, unknown> }[] = [];
  for (const f of readdirSync(dir)) {
    const pid = Number(f.slice(f.lastIndexOf(".") + 1));
    try {
      process.kill(pid, 0);
    } catch {
      rmSync(join(dir, f), { force: true });
      continue;
    }
    let rec: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown;
      if (parsed && typeof parsed === "object") rec = parsed as Record<string, unknown>;
    } catch {}
    out.push({ name: f, rec });
  }
  return out;
}

export function liveListeners(): Listener[] {
  const out: Listener[] = fromDaemon
    .filter((l) => l.kind === "listen")
    .map((l) => ({
      alias: l.channel,
      as: l.agent,
      ...(l.cwd ? { cwd: l.cwd } : {}),
      ...(l.harness ? { harness: l.harness as Listener["harness"] } : {}),
      ...(l.session ? { session: l.session } : {}),
      ...(l.pid ? { pid: l.pid } : {}),
    }));
  for (const { name, rec } of liveRecords()) {
    const parts = name.split(".");
    const alias = typeof rec.alias === "string" ? rec.alias : parts.length === 3 ? decodeURIComponent(parts[0]!) : null;
    const as = typeof rec.as === "string" ? rec.as : parts.length === 3 ? decodeURIComponent(parts[1]!) : null;
    if (alias === null || as === null) continue;
    out.push({
      alias,
      as,
      ...(typeof rec.cwd === "string" ? { cwd: rec.cwd } : {}),
      ...(typeof rec.harness === "string" ? { harness: rec.harness as Listener["harness"] } : {}),
      ...(typeof rec.session === "string" ? { session: rec.session } : {}),
      ...(Number.isInteger(rec.pid) ? { pid: rec.pid as number } : {}),
    });
  }
  return out;
}

export function isListening(alias: string, as: string): boolean {
  return liveListeners().some((l) => l.alias === alias && l.as === as);
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

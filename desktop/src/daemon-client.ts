// Talking to "kiwi daemon" over its local socket, in the daemon's own protocol (src/daemon/protocol.ts is
// the contract; this follows it, so the CLI and the app reach the same daemon the same way):
//   path: $KIWI_HOME/daemon.sock (a named pipe on Windows: \\.\pipe\kiwi-daemon-<home's tag>)
//   framing: newline-delimited JSON, one request per line, one response per line
//   request:  { "id": number, "verb": string, "token": string, ...params }   (params flat on the request;
//              the token is $KIWI_HOME/daemon.token, which the daemon writes mode 0600 beside its socket)
//   response: { "id": number, "ok": true, ...fields } | { "id": number, "ok": false, "error": string }
//   verbs this shell needs:
//     hello -> { version, machine: pk | null, mxpk, label, person: { pk, name, … } | null, certified }
//     adopt { cert, person: { pk, xpk, name } } -> { ok: true }
//       (cert is the MachineCert the app made for this machine's key)
// It used to send { method, params } and read { result }, which the daemon ignores: every hello
// timed out, so the app never saw its own daemon and never listed this computer.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { readHarnessRow, type HarnessRow } from "@kiwi/core/harnesses.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import type { MachineCert } from "@kiwi/core/person.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";

import type { LaunchAgentRequest, TermTabView } from "./bridge.ts";
import { childEnv } from "./child-env.ts";
import { launchedView } from "./launch-view.ts";

export interface HelloResult {
  version: string;
  machine: { pk: string; xpk: string };
  paired: { person: string; name: string; label: string } | null;
}

export type AdoptParams = ({ cert: MachineCert } | { links: DeviceLink[] }) & { person: { pk: string; xpk: string; name: string } };

export function kiwiHome(): string {
  return process.env["KIWI_HOME"] ?? path.join(os.homedir(), ".kiwi");
}

export function daemonSocketPath(home: string = kiwiHome()): string {
  // The same name the daemon picks (src/daemon/protocol.ts daemonSock): its home, as a tag.
  if (process.platform === "win32")
    return `\\\\.\\pipe\\kiwi-daemon-${
      home
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(-64) || "kiwi"
    }`;
  return path.join(home, "daemon.sock");
}

type Reply = { id: number; ok: boolean; error?: string } & Record<string, unknown>;

function daemonTokenFile(home: string): string {
  return path.join(home, "daemon.token");
}

export function daemonToken(home: string): string | null {
  try {
    const read = fs.readFileSync(daemonTokenFile(home), "utf8").trim();
    return read || null;
  } catch {
    // A daemon from before the token answers without one, and this frame still carries ours.
    return null;
  }
}

function call(home: string, verb: string, params: object = {}, timeoutMs = 5_000): Promise<Reply> {
  const token = daemonToken(home);
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(daemonSocketPath(home));
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      finish();
    };
    const timer = setTimeout(() => settle(() => reject(new Error("the daemon didn't answer"))), timeoutMs);
    let buf = "";
    conn.on("connect", () => conn.write(`${JSON.stringify({ ...params, id: 1, verb, ...(token ? { token } : {}) })}\n`));
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      settle(() => {
        try {
          const res = JSON.parse(buf.slice(0, nl)) as Reply;
          if (res.ok) resolve(res);
          else reject(new Error(typeof res.error === "string" ? res.error : "the daemon refused"));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
    conn.on("error", (err) => settle(() => reject(err)));
    conn.on("close", () => settle(() => reject(new Error("the daemon closed the connection"))));
  });
}

/** The daemon's hello, or null when none is listening (stale socket included) or it has no key yet. */
export async function daemonHello(home: string = kiwiHome(), timeoutMs = 5_000): Promise<HelloResult | null> {
  try {
    const r = await call(home, "hello", {}, timeoutMs);
    if (typeof r["version"] !== "string" || typeof r["machine"] !== "string" || typeof r["mxpk"] !== "string") return null;
    const person = r["person"] as { pk?: unknown; name?: unknown } | null;
    const label = typeof r["label"] === "string" ? r["label"] : "";
    return {
      version: r["version"],
      machine: { pk: r["machine"], xpk: r["mxpk"] },
      paired: r["certified"] && person && typeof person.pk === "string" ? { person: person.pk, name: typeof person.name === "string" ? person.name : "", label } : null,
    };
  } catch {
    return null;
  }
}

/** Ask the daemon to stop (an older one, before a newer starts). True once it said it would. */
export async function daemonStop(home: string = kiwiHome(), timeoutMs = 5_000): Promise<boolean> {
  try {
    await call(home, "stop", {}, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export async function daemonUnpair(home: string = kiwiHome(), timeoutMs = 10_000): Promise<void> {
  await call(home, "unpair", {}, timeoutMs);
}

/** Hand the daemon its cert from the person. Throws when it refuses. */
export async function daemonAdopt(home: string, params: AdoptParams, timeoutMs = 10_000): Promise<void> {
  await call(home, "adopt", params, timeoutMs);
}

export async function daemonHarnesses(home: string = kiwiHome()): Promise<HarnessRow[]> {
  const r = await call(home, "harnesses", {}, 30_000);
  const rows = Array.isArray(r["harnesses"]) ? r["harnesses"] : [];
  return rows.map(readHarnessRow).filter((row): row is HarnessRow => row !== null);
}

export async function daemonLaunch(req: LaunchAgentRequest, home: string = kiwiHome()): Promise<LaunchedView> {
  const r = await call(home, "launch", { ...req }, 150_000);
  return launchedView(r["launched"]);
}

export async function daemonMine(room: string, want: string | null, home: string = kiwiHome()): Promise<string> {
  const r = await call(home, "mine", { room, want }, 15_000);
  if (typeof r["pane"] !== "string") throw new Error("the daemon didn't say which terminal is yours");
  return r["pane"];
}

const tabsOf = (r: Reply): TermTabView[] =>
  (Array.isArray(r["tabs"]) ? (r["tabs"] as unknown[]) : []).flatMap((t) => {
    const { pane, label } = (t ?? {}) as { pane?: unknown; label?: unknown };
    return typeof pane === "string" && typeof label === "string" ? [{ pane, label }] : [];
  });

export async function daemonMineTabs(home: string = kiwiHome()): Promise<TermTabView[]> {
  return tabsOf(await call(home, "mine-tabs", {}, 5_000));
}

export async function daemonMineClose(pane: string, home: string = kiwiHome()): Promise<TermTabView[]> {
  return tabsOf(await call(home, "mine-close", { pane }, 5_000));
}

/**
 * Start `kiwi daemon` for `home`, apart from the app (it outlives a quit). It gets the app's relay:
 * a daemon not yet adopted follows the relay it starts on (src/daemon/pair.ts ensureMachine), and the
 * app's own environment rarely says one (KIWI_RELAY), so without it a self-hosted relay's app
 * would adopt a daemon on the public one.
 */
export const daemonLogPath = (home: string = kiwiHome()): string => path.join(home, "daemon.log");

const LOG_KEEP_BYTES = 1_000_000;

function openDaemonLog(home: string): number | "ignore" {
  const file = daemonLogPath(home);
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LOG_KEEP_BYTES) fs.renameSync(file, `${file}.1`);
    return fs.openSync(file, "a", 0o600);
  } catch {
    // A home the app can't write still gets a daemon, only without its log.
    return "ignore";
  }
}

export function noteDaemon(line: string, home: string = kiwiHome()): void {
  try {
    fs.appendFileSync(daemonLogPath(home), `${new Date().toISOString()} app: ${line}\n`, { mode: 0o600 });
  } catch {
    // Same as the daemon's own output: no log is better than no daemon.
  }
}

export function daemonEnv(from: NodeJS.ProcessEnv, home: string, relay: string): NodeJS.ProcessEnv {
  return { ...childEnv(from), KIWI_HOME: home, KIWI_RELAY: relay };
}

export function spawnDaemon(bin: string, home: string, relay: string): void {
  const log = openDaemonLog(home);
  const child = spawn(bin, ["daemon"], { cwd: os.homedir(), env: daemonEnv(process.env, home, relay), detached: true, stdio: ["ignore", log, log], windowsHide: true });
  if (typeof log === "number") fs.closeSync(log);
  // A binary that won't start shows as no hello (the caller waits for one), not an uncaught error.
  child.on("error", () => {});
  child.unref();
}

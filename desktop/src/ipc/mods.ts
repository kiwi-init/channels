import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ModInstalled, ModUpdate, ModUpdates } from "../bridge.ts";
import type { Serves } from "../calls.ts";
import { childEnv, sessionEnv } from "../child-env.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { modsHost, type ModsHost } from "../mods-host.ts";
import { inModsWorker } from "../mods-run.ts";
import { placedSeatsOf, terminalCalls, type PlacedSeat, type Run } from "../mods-terminal.ts";
import type { SnippetHome, TerminalSnippets } from "../mods-terminal-snippet.ts";
import { UI_CONTRACT } from "../ui-contract.ts";
import { runKiwi } from "./kiwi.ts";

let safeAtStart: string | null = null;

export const startModsSafe = (why: string): void => {
  safeAtStart ??= why;
};

type Info = ModInstalled & { version: string | null; needs: string[]; problem: string | null };
type Change = ModUpdate & { applied: boolean };
type Found = { changes: Change[]; current: string[]; skipped: ModUpdates["skipped"] };

const installed = ({ name, source, commit, local, link, changed }: Info): ModInstalled => ({ name, source, commit, local, link, changed });
const offered = ({ name, from, to, commits, added, dropped }: Change): ModUpdate => ({ name, from, to, commits, added, dropped });

const RUN_MS = 5_000;

const run: Run = (argv) =>
  new Promise((resolve) => {
    const [bin, ...args] = argv;
    if (!bin) return resolve({ status: null, stdout: "", stderr: "nothing to run" });
    execFile(bin, args, { timeout: RUN_MS, maxBuffer: 256 * 1024, env: childEnv() }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? null : 0;
      resolve({ status: code, stdout: typeof stdout === "string" ? stdout : "", stderr: typeof stderr === "string" ? stderr : "" });
    });
  });

function found(name: string, extra: readonly string[] = []): string | null {
  const dirs = [...extra, ...(childEnv().PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  for (const dir of dirs) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const bin = path.join(dir, name);
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch {
      // Not in this folder: try the next.
    }
  }
  return null;
}

const REX_APP = path.join(os.homedir(), "Library", "Application Support", "com.superlogical.rex", "RexServer", "Versions", "Current", "Rex Server.app", "Contents", "MacOS");

function writeTty(device: string, text: string): boolean {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(device);
    if (!stat.isCharacterDevice() || stat.uid !== process.getuid?.()) return false;
    fd = fs.openSync(device, fs.constants.O_WRONLY | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK);
    fs.writeSync(fd, text);
    return true;
  } catch {
    // The terminal went away, or isn't this person's: no mark, and the call says so.
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

const placedSeats = async (): Promise<PlacedSeat[]> => placedSeatsOf((await runKiwi(["wake", "seats", "--json"])).stdout);

const rexBin = (): string | null => found("rex", [process.env["REX_BIN_DIR"] ?? "", REX_APP]);

async function applyLive(copy: string, s: TerminalSnippets | null): Promise<void> {
  const seats = await placedSeats();
  const tmux = found("tmux");
  if (s?.tmux && tmux) {
    const own = path.join(process.env["TMUX_TMPDIR"] || "/tmp", `tmux-${process.getuid?.() ?? 0}`, "default");
    const sockets = new Set([own, ...seats.flatMap((x) => (x.tmux ? [x.tmux.socket] : []))]);
    for (const socket of sockets) if (fs.existsSync(socket)) await run([tmux, "-u", "-S", socket, "source-file", "-q", path.join(copy, "tmux.conf")]);
  }
  const rex = rexBin();
  if (rex && (!s || s.rex)) {
    const servers = [...new Set(seats.flatMap((x) => (x.rex ? [x.rex.server] : [])))];
    for (const server of servers.length ? servers : [null]) await run([rex, ...(server ? ["-S", server] : []), "--autostart=false", "config", "reload"]);
  }
}

function snippetHome(data: string): SnippetHome {
  return { copies: path.join(data, "mod-terminals"), record: path.join(data, "mod-terminals.json"), home: os.homedir(), env: sessionEnv() };
}

export function modsCalls(
  host: Host,
): Serves<
  | "mods"
  | "modBundle"
  | "approveMod"
  | "modFetch"
  | "modFailed"
  | "setModOn"
  | "modsSettled"
  | "modIcon"
  | "modDetails"
  | "modsInstalled"
  | "modUpdates"
  | "updateMod"
  | "removeMod"
  | "modTerminals"
  | "modTerminalFocus"
  | "modTerminalMark"
> {
  let mods: ModsHost | null = null;
  let started: Promise<ModsHost> | null = null;
  const terminal = snippetHome(host.app.path("data"));
  const terminals = terminalCalls({
    seats: placedSeats,
    run,
    tmux: () => found("tmux"),
    rex: rexBin,
    write: writeTty,
    front: async () => {
      if (process.platform === "darwin") await run(["/usr/bin/open", "-b", "com.superlogical.rex"]);
    },
  });
  const ready = (): Promise<ModsHost> => {
    if (started) return started;
    const m = modsHost({
      folder: path.join(kiwiHome(), "mods"),
      approvals: path.join(host.app.path("data"), "mods.json"),
      contract: UI_CONTRACT,
      push: (list) => {
        host.push("mods", list);
        if (!list.some((v) => v.state === "on" && v.approved.includes("terminal"))) void terminals.clear();
      },
      safe: safeAtStart,
      terminal,
      onTerminal: (name, s) => void applyLive(path.join(terminal.copies, name), s).catch(() => undefined),
    });
    mods = m;
    started = m.start().then(() => m);
    host.app.onQuit(() => mods?.stop());
    return started;
  };
  const allowed = async (name: unknown): Promise<void> => {
    const m = (await ready()).list().find((v) => v.name === name);
    if (m?.state !== "on" || !m.needs.includes("terminal") || !m.approved.includes("terminal"))
      throw new Error(`${String(name)} may not reach your terminals: it didn't ask for them, or you didn't approve it`);
  };
  return {
    mods: async () => (await ready()).list(),
    modBundle: async (name) => (await ready()).bundle(String(name)),
    approveMod: async (name, needs) => (await ready()).approve(String(name), needs),
    modFetch: async (name, req) => (await ready()).fetch(String(name), req),
    modFailed: async (name, hash, why) => (await ready()).failed(String(name), String(hash), String(why)),
    setModOn: async (name, on) => (await ready()).setOn(String(name), on === true),
    modsSettled: async () => (await ready()).settled(),
    modIcon: async (name) => (await ready()).icon(String(name)),
    modDetails: async (name) => (await ready()).details(String(name)),
    modsInstalled: async () => (await inModsWorker<Info[]>({ op: "list", home: kiwiHome() })).map(installed),
    modUpdates: async () => {
      const found = await inModsWorker<Found>({ op: "check", home: kiwiHome() });
      return { changes: found.changes.map(offered), skipped: found.skipped };
    },
    updateMod: async (name) => {
      const found = await inModsWorker<Found>({ op: "update", home: kiwiHome(), name: String(name) });
      const skipped = found.skipped.find((s) => s.name === name);
      if (skipped) throw new Error(`${skipped.name} ${skipped.why}`);
      const h = await ready();
      await h.rescan();
      return h.list();
    },
    removeMod: async (name, force) => {
      await inModsWorker({ op: "remove", home: kiwiHome(), name: String(name), force: force === true });
      return (await ready()).forget(String(name));
    },
    modTerminals: async (name) => {
      await allowed(name);
      return terminals.list();
    },
    modTerminalFocus: async (name, seat) => {
      await allowed(name);
      await terminals.focus(seat);
    },
    modTerminalMark: async (name, seat, mark) => {
      await allowed(name);
      await terminals.mark(seat, mark);
    },
  };
}

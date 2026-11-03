import { isHookHarness, readHookRow, type HookHarness, type HookRow } from "@kiwi/core/harnesses.ts";
import { readWakeSeat, type WakeSeat } from "@kiwi/core/wake.ts";
import type { Serves } from "../calls.ts";
import { daemonHarnesses } from "../daemon-client.ts";
import { runKiwi } from "./kiwi.ts";

const isSwitch = (v: unknown): v is "on" | "off" => v === "on" || v === "off";

async function must(args: string[]): Promise<string> {
  const done = await runKiwi(args);
  if (done.code !== 0)
    throw new Error(
      done.stderr
        .trim()
        .split("\n")
        .at(-1)
        ?.replace(/^kiwi: /, "") || `kiwi ${args.join(" ")} didn't finish`,
    );
  return done.stdout;
}

const isHooked = (v: unknown): v is HookHarness => isHookHarness(v) && v !== "opencode";

export type ClaudeHere = "wakes" | "old" | "none" | null;

async function claudeHere(): Promise<ClaudeHere> {
  const rows = await daemonHarnesses().catch(() => null);
  if (!rows) return null;
  const claude = rows.find((r) => r.harness === "claude");
  return !claude?.path ? "none" : claude.wake !== null ? "wakes" : "old";
}

export function withClaude(r: HookRow, here: ClaudeHere): HookRow {
  if (r.harness !== "claude") return r;
  if (r.state === "partial" && (here === "old" || here === "none")) return { ...r, state: "installed" };
  return r.state === "missing" && here === "none" ? { ...r, state: "absent" } : r;
}

async function hooks(): Promise<HookRow[]> {
  const [stdout, claude] = await Promise.all([must(["hooks", "status", "--json"]), claudeHere()]);
  const parsed = answer(stdout);
  const listed = parsed && typeof parsed === "object" ? (parsed as { hooks?: unknown }).hooks : undefined;
  const rows = Array.isArray(listed) ? listed.map(readHookRow).filter((r): r is HookRow => r !== null) : [];
  return rows.map((r) => withClaude(r, claude));
}

const ROOM_ID = /^[0-9a-f]{32}$/;
const isAgentName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64 && !v.startsWith("-");

function wakeSeatsOf(stdout: string): WakeSeat[] {
  const parsed = answer(stdout);
  const listed = parsed && typeof parsed === "object" ? (parsed as { seats?: unknown }).seats : undefined;
  return Array.isArray(listed) ? listed.map(readWakeSeat).filter((s): s is WakeSeat => s !== null) : [];
}

function answer(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one JSON value and nothing else; anything else is no answer.
    return null;
  }
}

async function contextLine(args: string[]): Promise<"on" | "off" | null> {
  const got = await runKiwi(args);
  if (got.code !== 0) return null;
  const parsed = answer(got.stdout);
  const on = parsed && typeof parsed === "object" ? (parsed as { contextLine?: unknown }).contextLine : undefined;
  return isSwitch(on) ? on : null;
}

export function hooksCalls(): Serves<"contextLine" | "setContextLine" | "hooks" | "setHooks" | "wakeSeats" | "setWake"> {
  return {
    contextLine: () => contextLine(["context-line", "status", "--json"]),
    setContextLine: (to: unknown) => {
      if (!isSwitch(to)) throw new Error("setContextLine takes on or off");
      return contextLine(["context-line", to, "--json"]);
    },
    wakeSeats: async () => wakeSeatsOf(await must(["wake", "seats", "--json"])),
    setWake: async (room: unknown, agent: unknown, to: unknown) => {
      if (typeof room !== "string" || !ROOM_ID.test(room) || !isAgentName(agent) || !isSwitch(to)) throw new Error("setWake takes a room id, an agent's name, and on or off");
      return wakeSeatsOf(await must(["wake", "seat", room, agent, to, "--json"]));
    },
    hooks: () => hooks(),
    setHooks: async (harness: unknown, to: unknown) => {
      if (!isHooked(harness) || !isSwitch(to)) throw new Error("setHooks takes a harness with hooks, and on or off");
      const listen = harness === "claude" && to === "on" && (await claudeHere()) === "wakes";
      await must(["hooks", to === "on" ? "install" : "uninstall", harness, ...(listen ? ["--listen"] : [])]);
      return hooks();
    },
  };
}

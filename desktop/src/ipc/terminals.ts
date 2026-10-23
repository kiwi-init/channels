import { readPlacedSeat, readShowResult, type PlacedSeat, type ShowResult, type TerminalId, type TerminalsStatus } from "@kiwi/core/terminals.ts";
import type { Serves } from "../calls.ts";
import { terminalsOf } from "../terminals-status.ts";
import { runKiwi } from "./kiwi.ts";

type HelperId = Exclude<TerminalId, "app">;

const isHelperId = (v: unknown): v is HelperId => v === "rex" || v === "tmux";
const isTerminalId = (v: unknown): v is TerminalId => v === "app" || isHelperId(v);
const isSwitch = (v: unknown): v is "on" | "off" => v === "on" || v === "off";

async function terminals(): Promise<TerminalsStatus | null> {
  const got = await runKiwi(["terminal", "status", "--json"]);
  return got.code === 0 ? terminalsOf(got.stdout) : null;
}

async function change(args: string[]): Promise<TerminalsStatus | null> {
  const done = await runKiwi(args);
  if (done.code !== 0)
    throw new Error(
      done.stderr
        .trim()
        .split("\n")
        .at(-1)
        ?.replace(/^kiwi: /, "") || `kiwi ${args.join(" ")} didn't finish`,
    );
  return terminals();
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

function seats(stdout: string): PlacedSeat[] {
  const parsed = answer(stdout);
  return Array.isArray(parsed) ? parsed.map(readPlacedSeat).filter((s): s is PlacedSeat => s !== null) : [];
}

export function terminalsCalls(): Serves<"terminals" | "terminalHelpers" | "terminalPrefer" | "setLaunches" | "contextLine" | "setContextLine" | "seatPlaces" | "showSeat"> {
  return {
    terminals: () => terminals(),
    terminalHelpers: (id: unknown, to: unknown) => {
      if (!isHelperId(id) || !isSwitch(to)) throw new Error("terminalHelpers takes rex or tmux, and on or off");
      return change(["terminal", to === "on" ? "download" : "remove", id]);
    },
    terminalPrefer: (id: unknown) => {
      if (!isTerminalId(id)) throw new Error("terminalPrefer takes app, rex or tmux");
      return change(["terminal", "prefer", id]);
    },
    setLaunches: (to: unknown) => {
      if (!isSwitch(to)) throw new Error("setLaunches takes on or off");
      return change(["launches", to]);
    },
    contextLine: () => contextLine(["context-line", "status", "--json"]),
    setContextLine: (to: unknown) => {
      if (!isSwitch(to)) throw new Error("setContextLine takes on or off");
      return contextLine(["context-line", to, "--json"]);
    },
    seatPlaces: async (): Promise<PlacedSeat[]> => {
      const listed = await runKiwi(["terminal", "seats", "--json"]);
      return listed.code === 0 ? seats(listed.stdout) : [];
    },
    showSeat: async (value: unknown): Promise<ShowResult> => {
      const seat = readPlacedSeat(value);
      if (!seat) return { ok: false, why: "failed" };
      const done = await runKiwi(["terminal", "show", "--seat", JSON.stringify(seat)]);
      return done.code === 0 ? readShowResult(answer(done.stdout)) : { ok: false, why: "failed" };
    },
  };
}

import { NAME_RE } from "@kiwi/core/membership.ts";
import { loadConfig } from "../config.ts";
import { selfArgv } from "../hooks/self.ts";
import { openHosted, type Hosted } from "../launch/place.ts";
import type { Placed } from "../terminals/plugin.ts";
import { isLoopHarness, type LoopHarness } from "./recipes.ts";

export interface LoopStart {
  channel: string;
  as: string;
  folder: string;
  harness: LoopHarness;
  model?: string;
  effort?: string;
}

const CHOICE = /^[\x21-\x7e]{1,128}$/;

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function readLoopStart(x: Record<string, unknown>): LoopStart | null {
  const channel = text(x.channel);
  const as = text(x.as);
  const folder = text(x.folder);
  const harness = x.harness ?? "claude";
  const model = text(x.model);
  const effort = text(x.effort);
  if (!channel || !as || !NAME_RE.test(as) || !folder || typeof harness !== "string" || !isLoopHarness(harness)) return null;
  if ((x.model !== undefined && !(model && CHOICE.test(model))) || (x.effort !== undefined && !(effort && CHOICE.test(effort)))) return null;
  return { channel, as, folder, harness, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

export function loopArgv(self: readonly string[], s: LoopStart): string[] {
  return [...self, "loop", `--channel=${s.channel}`, `--as=${s.as}`, `--harness=${s.harness}`, ...(s.model ? [`--model=${s.model}`] : []), ...(s.effort ? [`--effort=${s.effort}`] : [])];
}

export async function startLoop(s: LoopStart, hosted: Hosted, channels: readonly string[] = Object.keys(loadConfig().channels), self: readonly string[] = selfArgv()): Promise<Placed> {
  if (!channels.includes(s.channel)) return { ok: false, why: "bad-request", detail: `unknown channel "${s.channel}" (see: kiwi channels)` };
  const env = process.env.KIWI_HOME ? { KIWI_HOME: process.env.KIWI_HOME } : undefined;
  return openHosted({ argv: loopArgv(self, s), folder: s.folder, name: `${s.as} loop`, ...(env ? { env } : {}) }, hosted);
}

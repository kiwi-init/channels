import { execFile } from "node:child_process";
import { ipcMain } from "electron";

import type { RexSeatView, RexShowResult } from "../bridge.ts";
import { kiwiCli } from "../bundled-daemon.ts";

function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return kiwiCli().then(
    (bin) =>
      new Promise((resolve) => {
        execFile(bin, args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
          resolve({ code, stdout: typeof stdout === "string" ? stdout : "", stderr: typeof stderr === "string" ? stderr : "" });
        });
      }),
    () => ({ code: 1, stdout: "", stderr: "" }),
  );
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function seat(value: unknown): RexSeatView | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  const alias = text(s["alias"], 200);
  const agent = text(s["agent"], 64);
  const server = text(s["server"], 512);
  const session = text(s["session"], 128);
  const block = text(s["block"], 128);
  if (!alias || !agent || !server || !session || !block) return null;
  const room = text(s["room"], 128);
  return { alias, agent, ...(room ? { room } : {}), server, session, block };
}

function seats(stdout: string): RexSeatView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one array and nothing else; anything else is not a seat list.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(seat).filter((s): s is RexSeatView => s !== null);
}

function result(stdout: string): RexShowResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // A refused or crashed call says nothing we can show; the item says Rex didn't open it.
    return { ok: false, why: "failed" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, why: "failed" };
  const got = parsed as Record<string, unknown>;
  if (got["ok"] === true) return { ok: true };
  const why = got["why"];
  return { ok: false, why: why === "no-rex" || why === "no-server" || why === "remote-control" ? why : "failed" };
}

export function wireRexIpc(): void {
  ipcMain.handle("kiwi:rex-seats", async (): Promise<RexSeatView[]> => {
    const listed = await run(["rex", "seats", "--json"]);
    return listed.code === 0 ? seats(listed.stdout) : [];
  });
  ipcMain.handle("kiwi:rex-show", async (_e, value: unknown): Promise<RexShowResult> => {
    const s = seat(value);
    if (!s) return { ok: false, why: "failed" };
    const done = await run(["rex", "show", "--server", s.server, "--session", s.session, "--block", s.block]);
    return done.code === 0 ? result(done.stdout) : { ok: false, why: "failed" };
  });
}

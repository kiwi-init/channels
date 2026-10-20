import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";

import { readHarnessRow, type HarnessRow } from "@kiwi/core/harnesses.ts";
import type { ComputerView, FromMachine, LaunchAgentRequest, LaunchedView, MachineView } from "../bridge.ts";
import { daemonHarnesses, daemonHello, daemonLaunch } from "../daemon-client.ts";
import { launchedView, launchRequestOf, MACHINE_PK } from "../launch-view.ts";
import { askMachine, machineOnline, type Asked, type Asker } from "../remote.ts";
import { requirePerson, store } from "../store.ts";
import { runKiwi } from "./rex.ts";

const ROOM = /^[A-Za-z0-9_-]{1,128}$/;
const ROOM_ID = /^[0-9a-f]{32}$/;

function folders(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one array and nothing else; anything else is no folders.
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string" && f.startsWith("/")).slice(0, 20) : [];
}

const ASK_MS = 10_000;
const LAUNCH_MS = 150_000;

const asker = (): Asker => ({ person: requirePerson(), relay: store.relayUrl });

function paired(machinePk: unknown): ComputerView | null {
  if (typeof machinePk !== "string" || !MACHINE_PK.test(machinePk)) return null;
  return store.computers.find((c) => c.machinePk === machinePk && !c.own) ?? null;
}

function fromMachine<T>(asked: Asked, read: (result: Record<string, unknown>) => T | null): FromMachine<T> {
  if (!asked.ok) return { ok: false, detail: asked.detail };
  const result = asked.result && typeof asked.result === "object" ? (asked.result as Record<string, unknown>) : null;
  const value = result?.["ok"] === true ? read(result) : null;
  return value === null ? { ok: false, detail: typeof result?.["detail"] === "string" ? result["detail"] : "that computer answered in a shape this app doesn't know" } : { ok: true, value };
}

async function machines(): Promise<MachineView[]> {
  const here = await daemonHello().catch(() => null);
  return Promise.all(
    store.computers.map(async (c): Promise<MachineView> => ({
      machinePk: c.machinePk,
      label: c.label,
      os: c.os,
      own: !!c.own,
      online: c.own ? here !== null : await machineOnline(asker(), c.machinePk),
    })),
  );
}

async function launchOn(c: ComputerView, req: LaunchAgentRequest): Promise<LaunchedView> {
  const args = { harness: req.harness, folder: req.folder, code: req.code, relay: req.relay, ...(req.nick ? { nick: req.nick } : {}), ...(req.persona ? { persona: req.persona } : {}) };
  const asked = await askMachine(asker(), { pk: c.machinePk, xpk: c.machineXpk }, "launch", args, { timeoutMs: LAUNCH_MS, id: req.launch });
  if (asked.ok) return launchedView(asked.result);
  if (asked.why === "no-answer") return { ok: false, why: "failed", detail: `No answer yet: it may still be starting on ${c.label}. Check that computer before you try again.` };
  return { ok: false, why: "failed", detail: asked.detail };
}

const PICK: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"], buttonLabel: "Choose" };

export function wireLaunchIpc(): void {
  ipcMain.handle("kiwi:harnesses", (): Promise<HarnessRow[]> => daemonHarnesses().catch(() => []));
  ipcMain.handle("kiwi:seat-folders", async (_e, roomId: unknown): Promise<string[]> => {
    if (typeof roomId !== "string" || !ROOM.test(roomId)) return [];
    const listed = await runKiwi(["folders", "--room", roomId, "--json"]);
    return listed.code === 0 ? folders(listed.stdout) : [];
  });
  ipcMain.handle("kiwi:choose-folder", async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await (win ? dialog.showOpenDialog(win, PICK) : dialog.showOpenDialog(PICK));
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle("kiwi:launch-agent", async (_e, value: unknown): Promise<LaunchedView> => {
    const req = launchRequestOf(value);
    if (!req) return { ok: false, why: "bad-request", detail: "the app sent a launch it can't check" };
    const there = req.machinePk ? paired(req.machinePk) : null;
    if (req.machinePk && !there) return { ok: false, why: "bad-request", detail: "that isn't one of your paired computers" };
    const launched = there ? launchOn(there, req) : daemonLaunch(req);
    return launched.catch((err: unknown) => ({ ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) }));
  });
  ipcMain.handle("kiwi:machines", (): Promise<MachineView[]> => machines().catch(() => []));
  ipcMain.handle("kiwi:harnesses-on", async (_e, machinePk: unknown): Promise<FromMachine<HarnessRow[]>> => {
    const c = paired(machinePk);
    if (!c) return { ok: false, detail: "that isn't one of your paired computers" };
    const asked = await askMachine(asker(), { pk: c.machinePk, xpk: c.machineXpk }, "harnesses", {}, { timeoutMs: ASK_MS });
    return fromMachine(asked, (r) => (Array.isArray(r["harnesses"]) ? r["harnesses"].map(readHarnessRow).filter((row): row is HarnessRow => row !== null) : null));
  });
  ipcMain.handle("kiwi:folders-on", async (_e, machinePk: unknown, roomId: unknown): Promise<FromMachine<string[]>> => {
    const c = paired(machinePk);
    if (!c || typeof roomId !== "string" || !ROOM_ID.test(roomId)) return { ok: false, detail: "that isn't one of your paired computers" };
    const asked = await askMachine(asker(), { pk: c.machinePk, xpk: c.machineXpk }, "folders", { room: roomId }, { timeoutMs: ASK_MS });
    return fromMachine(asked, (r) => (Array.isArray(r["folders"]) ? r["folders"].filter((f): f is string => typeof f === "string" && f.startsWith("/")).slice(0, 20) : null));
  });
}

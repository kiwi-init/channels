import { signRequest } from "@kiwi/core/auth.ts";
import { readComputerSettings, type ComputerSettings } from "@kiwi/core/computer-settings.ts";
import { readHarnessRow, type HarnessRow } from "@kiwi/core/harnesses.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { choicesOf } from "@kiwi/core/launch-options.ts";
import { makeAsk, readAnswer, type MachineVerb } from "@kiwi/core/machine-ask.ts";
import { newSecret, openMailbox } from "@kiwi/core/mailbox.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";
import type { FromMachine, LaunchAgentRequest } from "./bridge.ts";
import { launchedView, MACHINE_PK } from "./launch-view.ts";

export interface Asker {
  signer: Identity;
  person: string;
  relay: string;
  fetch?: typeof fetch;
}

export type Asked = { ok: true; result: unknown } | { ok: false; why: "not-registered" | "busy" | "no-answer" | "failed"; detail: string };

export const NO_ANSWER = "No answer: that computer is off or offline, its clock is more than 2 minutes off, or it runs a kiwi older than this app.";

const POLL_MS = 1_000;
const ASK_MS = 10_000;
const LAUNCH_MS = 150_000;
const LABEL_MAX = 64;

interface Machine {
  pk: string;
  xpk: string;
}

export interface PairedComputer {
  key: string;
  xpk: string;
  label: string;
  online: boolean;
  since?: number;
  seenAt: number;
}

export async function askMachine(asker: Asker, machine: { pk: string; xpk: string }, verb: MachineVerb, args: Record<string, unknown>, opts: { timeoutMs: number; id?: string }): Promise<Asked> {
  const fetchImpl = asker.fetch ?? fetch;
  const reply = newSecret();
  const { box, id } = await makeAsk(asker.signer, machine, { verb, args, reply, ...(opts.id ? { id: opts.id } : {}) });
  const path = `/v1/machine/${machine.pk}/inbox`;
  const body = JSON.stringify({ box });
  const auth = await signRequest(asker.signer, `machine:${machine.pk}`, "POST", path, body);
  let sent: Response;
  try {
    sent = await fetchImpl(new URL(path, asker.relay), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body });
  } catch (err) {
    return { ok: false, why: "failed", detail: `couldn't reach the relay: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (sent.status === 403)
    return {
      ok: false,
      why: "not-registered",
      detail: "That computer hasn't come online on this relay since it was paired: start kiwi's daemon on it (kiwi daemon), and update kiwi there if it's older than this app.",
    };
  if (sent.status === 429) return { ok: false, why: "busy", detail: "That computer has too many asks waiting. Try again in a minute." };
  if (sent.status !== 202) return { ok: false, why: "failed", detail: `the relay answered ${sent.status}` };
  const mailbox = await openMailbox(asker.relay, reply, fetchImpl);
  try {
    const raw = await mailbox.wait<unknown>("b", { timeoutMs: opts.timeoutMs, everyMs: POLL_MS });
    if (raw === null) return { ok: false, why: "no-answer", detail: NO_ANSWER };
    const answer = await readAnswer(raw, { machine: machine.pk, id });
    return answer ? { ok: true, result: answer.result } : { ok: false, why: "failed", detail: "the answer wasn't signed by that computer" };
  } catch (err) {
    return { ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    await mailbox.drop().catch(() => {});
  }
}

export async function machineOnline(asker: Asker, machinePk: string): Promise<boolean | null> {
  const path = `/v1/machine/${machinePk}`;
  const auth = await signRequest(asker.signer, `machine:${machinePk}`, "GET", path);
  try {
    const res = await (asker.fetch ?? fetch)(new URL(path, asker.relay), { headers: { authorization: `Bearer ${auth}` } });
    if (!res.ok) return null;
    const got = (await res.json()) as { online?: unknown };
    return typeof got.online === "boolean" ? got.online : null;
  } catch {
    // An unreachable relay says nothing about the computer: no dot rather than a red one.
    return null;
  }
}

function fromMachine<T>(asked: Asked, read: (result: Record<string, unknown>) => T | null): FromMachine<T> {
  if (!asked.ok) return { ok: false, detail: asked.detail };
  const result = asked.result && typeof asked.result === "object" ? (asked.result as Record<string, unknown>) : null;
  const value = result?.["ok"] === true ? read(result) : null;
  return value === null ? { ok: false, detail: typeof result?.["detail"] === "string" ? result["detail"] : "that computer answered in a shape this app doesn't know" } : { ok: true, value };
}

export async function remoteHarnesses(asker: Asker, machine: Machine): Promise<FromMachine<{ harnesses: HarnessRow[]; bypass: boolean }>> {
  const asked = await askMachine(asker, machine, "harnesses", {}, { timeoutMs: ASK_MS });
  return fromMachine(asked, (r) =>
    Array.isArray(r["harnesses"]) ? { harnesses: r["harnesses"].map(readHarnessRow).filter((row): row is HarnessRow => row !== null), bypass: r["bypass"] === true } : null,
  );
}

export async function harnessesOn(asker: Asker, machine: Machine): Promise<FromMachine<HarnessRow[]>> {
  const got = await remoteHarnesses(asker, machine);
  return got.ok ? { ok: true, value: got.value.harnesses } : got;
}

export async function foldersOn(asker: Asker, machine: Machine, roomId: string): Promise<FromMachine<string[]>> {
  const asked = await askMachine(asker, machine, "folders", { room: roomId }, { timeoutMs: ASK_MS });
  return fromMachine(asked, (r) => (Array.isArray(r["folders"]) ? r["folders"].filter((f): f is string => typeof f === "string" && f.startsWith("/")).slice(0, 20) : null));
}

export async function settingsOn(asker: Asker, machine: Machine): Promise<FromMachine<ComputerSettings>> {
  const asked = await askMachine(asker, machine, "settings", {}, { timeoutMs: ASK_MS });
  return fromMachine(asked, (r) => readComputerSettings(r["settings"]));
}

export async function launchOn(asker: Asker, machine: Machine & { label: string }, req: LaunchAgentRequest): Promise<LaunchedView> {
  const args = {
    harness: req.harness,
    folder: req.folder,
    code: req.code,
    relay: req.relay,
    ...(req.nick ? { nick: req.nick } : {}),
    ...(req.persona ? { persona: req.persona } : {}),
    ...choicesOf(req),
  };
  const asked = await askMachine(asker, machine, "launch", args, { timeoutMs: LAUNCH_MS, id: req.launch });
  if (asked.ok) return launchedView(asked.result);
  if (asked.why === "no-answer") return { ok: false, why: "failed", detail: `No answer yet: it may still be starting on ${machine.label}. Check that computer before you try again.` };
  return { ok: false, why: "failed", detail: asked.detail };
}

function readComputer(x: unknown): PairedComputer | null {
  if (!x || typeof x !== "object") return null;
  const { key, xpk, label, online, since, seenAt } = x as Record<string, unknown>;
  if (typeof key !== "string" || !MACHINE_PK.test(key) || typeof xpk !== "string" || !MACHINE_PK.test(xpk)) return null;
  if (typeof label !== "string" || label.length > LABEL_MAX || typeof online !== "boolean" || typeof seenAt !== "number") return null;
  return { key, xpk, label, online, ...(online && typeof since === "number" ? { since } : {}), seenAt };
}

export async function unpairAt(asker: Asker, machinePk: string): Promise<boolean> {
  const path = `/v1/machine/${machinePk}`;
  const auth = await signRequest(asker.signer, `machine:${machinePk}`, "DELETE", path);
  try {
    const res = await (asker.fetch ?? fetch)(new URL(path, asker.relay), { method: "DELETE", headers: { authorization: `Bearer ${auth}` } });
    return res.ok || res.status === 404;
  } catch {
    // An unreachable relay keeps the binding for now; the computer is already gone from this app's list.
    return false;
  }
}

export async function personMachines(asker: Asker): Promise<FromMachine<PairedComputer[]>> {
  const path = `/v1/person/${asker.person}/machines`;
  const auth = await signRequest(asker.signer, `person:${asker.person}`, "GET", path);
  let res: Response;
  try {
    res = await (asker.fetch ?? fetch)(new URL(path, asker.relay), { headers: { authorization: `Bearer ${auth}` } });
  } catch (err) {
    return { ok: false, detail: `couldn't reach the relay: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status === 404) return { ok: false, detail: "This relay can't list your computers yet: it needs an update." };
  if (!res.ok) return { ok: false, detail: `the relay answered ${res.status}` };
  const body = (await res.json().catch(() => null)) as { machines?: unknown } | null;
  if (!Array.isArray(body?.machines)) return { ok: false, detail: "the relay answered in a shape this app doesn't know" };
  return { ok: true, value: body.machines.map(readComputer).filter((c): c is PairedComputer => c !== null) };
}

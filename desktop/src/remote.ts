import { signRequest } from "@kiwi/core/auth.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { makeAsk, readAnswer, type MachineVerb } from "@kiwi/core/machine-ask.ts";
import { newSecret, openMailbox } from "@kiwi/core/mailbox.ts";

export interface Asker {
  person: Identity;
  relay: string;
  fetch?: typeof fetch;
}

export type Asked = { ok: true; result: unknown } | { ok: false; why: "not-registered" | "busy" | "no-answer" | "failed"; detail: string };

export const NO_ANSWER = "No answer: that computer is off or offline, its clock is more than 2 minutes off, or it runs a kiwi older than this app.";

const POLL_MS = 1_000;

export async function askMachine(asker: Asker, machine: { pk: string; xpk: string }, verb: MachineVerb, args: Record<string, unknown>, opts: { timeoutMs: number; id?: string }): Promise<Asked> {
  const fetchImpl = asker.fetch ?? fetch;
  const reply = newSecret();
  const { box, id } = await makeAsk(asker.person, machine, { verb, args, reply, ...(opts.id ? { id: opts.id } : {}) });
  const path = `/v1/machine/${machine.pk}/inbox`;
  const body = JSON.stringify({ box });
  const auth = await signRequest(asker.person, `machine:${machine.pk}`, "POST", path, body);
  let sent: Response;
  try {
    sent = await fetchImpl(new URL(path, asker.relay), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body });
  } catch (err) {
    return { ok: false, why: "failed", detail: `couldn't reach the relay: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (sent.status === 403) return { ok: false, why: "not-registered", detail: "That computer hasn't registered with this relay: update kiwi on it and keep its daemon running." };
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
  const auth = await signRequest(asker.person, `machine:${machinePk}`, "GET", path);
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

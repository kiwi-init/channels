import { answerPair, newSecret, openMailbox, pairCode, readPairAsk, type Mailbox, type PairAsk } from "@kiwi/core/mailbox.ts";
import type { PairAskView } from "./bridge.ts";
import { requirePerson, store, upsertComputer } from "./store.ts";

let pairing: { secret: string; mailbox: Mailbox; ask: PairAsk | null; stop: AbortController } | null = null;

export async function pairBegin(): Promise<{ code: string }> {
  pairing?.stop.abort();
  pairing?.mailbox.drop().catch(() => {});
  const secret = newSecret();
  pairing = { secret, mailbox: await openMailbox(store.relayUrl, secret), ask: null, stop: new AbortController() };
  return { code: pairCode(secret) };
}

export async function pairPoll(): Promise<PairAskView | null> {
  const p = pairing;
  if (!p) throw new Error("pairing hasn't started");
  const raw = await p.mailbox.wait("a", { timeoutMs: 20_000, everyMs: 1_500, signal: p.stop.signal }).catch((err: unknown) => {
    if (pairing === p) throw err;
    return null;
  });
  const ask = await readPairAsk(raw, p.mailbox);
  if (!ask || pairing !== p) return null;
  p.ask = ask;
  return { label: ask.label, os: ask.os, machinePk: ask.pk, at: ask.at };
}

export async function pairAnswer(accept: boolean): Promise<{ machinePk: string } | null> {
  if (!pairing) throw new Error("pairing hasn't started");
  const { mailbox, ask, stop } = pairing;
  pairing = null;
  stop.abort();
  if (!accept || !ask) {
    await mailbox.drop();
    return null;
  }
  const person = requirePerson();
  await answerPair(person, mailbox, ask);
  upsertComputer({ label: ask.label, os: ask.os, machinePk: ask.pk, machineXpk: ask.mxpk, personPk: person.pk, at: Date.now() });
  return { machinePk: ask.pk };
}

export async function pairCancel(): Promise<void> {
  const p = pairing;
  pairing = null;
  p?.stop.abort();
  await p?.mailbox.drop().catch(() => {});
}

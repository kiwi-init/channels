import { join } from "node:path";
import { DEFAULT_RELAY, home } from "../config.ts";
import { withExchangeKey } from "../identity.ts";
import { loadMachine, newMachine, saveMachine, type MachineFile } from "../machine.ts";
import { MAILBOX_TTL_MS, MailboxError, askToPair, openMailbox, readPairAnswer, readPairCode } from "../mailbox.ts";
import type { MachineCert } from "../person.ts";

export interface PairedPerson {
  pk: string;
  xpk: string;
  name: string;
}

export interface PairedMachine extends MachineFile {
  cert?: MachineCert;
  person?: PairedPerson;
}

export function loadPairedMachine(): PairedMachine | null {
  return loadMachine() as PairedMachine | null;
}

export async function ensureMachine(relay: string): Promise<PairedMachine> {
  let m = loadPairedMachine();
  if (!m) {
    m = (await newMachine(relay)) as PairedMachine;
    saveMachine(m);
    return m;
  }
  if (!m.identity.xpk) {
    m = { ...m, identity: await withExchangeKey(m.identity) };
    saveMachine(m);
  }
  if (!m.cert && m.relay !== relay) {
    m = { ...m, relay };
    saveMachine(m);
  }
  return m;
}

export class PairError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
    this.name = "PairError";
  }
}

const pairRefused = (relay: string, err: unknown): PairError => {
  if (err instanceof MailboxError && err.status === 0) return new PairError(`couldn't reach ${relay}: ${err.message}`);
  if (err instanceof MailboxError) return new PairError(`the relay refused (${err.status}): ${err.message}`);
  return new PairError(err instanceof Error ? err.message : String(err));
};

export async function pairComputer(
  code: string,
  opts: { relay?: string; timeoutMs?: number; signal?: AbortSignal; onStatus?: (line: string) => void } = {},
): Promise<{ cert: MachineCert; person: PairedPerson }> {
  const secret = readPairCode((code ?? "").trim());
  if (!secret) throw new PairError("that isn't a pairing code (they look like kp1-…: the app shows it, you run kiwi pair with it)");
  const relay = (opts.relay ?? process.env.KIWI_RELAY ?? DEFAULT_RELAY).replace(/\/+$/, "");
  const say = opts.onStatus ?? ((line: string) => process.stdout.write(line + "\n"));
  const m = await ensureMachine(relay);
  const mailbox = await openMailbox(relay, secret).catch((err: unknown) => {
    throw pairRefused(relay, err);
  });
  await askToPair(m.identity, mailbox, m.label, process.platform).catch((err: unknown) => {
    if (err instanceof MailboxError && err.status === 409) return;
    throw pairRefused(relay, err);
  });
  say(`asked to pair "${m.label}": approve it in your app, and this waits here.`);
  const raw = await mailbox
    .wait<unknown>("b", { timeoutMs: opts.timeoutMs ?? MAILBOX_TTL_MS, everyMs: 1_500, ...(opts.signal ? { signal: opts.signal } : {}) })
    .catch((err: unknown) => {
      throw pairRefused(relay, err);
    });
  if (raw === null) throw new PairError(`nothing approved "${m.label}" in time; run the same command with a fresh code to try again`, 3);
  const answer = await readPairAnswer(raw, m.identity.pk);
  if (!answer) throw new PairError("the app's answer didn't check out (another computer, or a forged answer); approve again with a fresh code");
  const paired: PairedMachine = { ...m, cert: answer.cert, person: answer.person };
  saveMachine(paired);
  await mailbox.drop();
  say(`paired with ${answer.person.name}: this computer's cert is kept in ${join(home(), "machine.json")}.`);
  return { cert: answer.cert, person: answer.person };
}

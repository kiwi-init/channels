import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import { askToEnroll, enrollDigits, enrollMailbox, ENROLL_TTL_MS, readEnrollGrant, type Enrollment } from "@kiwi/core/enroll.ts";
import { workosDeviceSignIn, type DeviceSignIn } from "@kiwi/core/workos.ts";
import { home } from "./config.ts";
import { loadPairedMachine, PairError, type PairedMachine } from "./daemon/pair.ts";
import { inlineText } from "@kiwi/core/membership.ts";
import { personFingerprint } from "@kiwi/core/fingerprint.ts";
import { newMachine, saveMachine, type EnrolledDevice } from "./machine.ts";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

export interface LoginOpts {
  relay: string;
  user?: string;
  say?: (line: string) => void;
  showSignIn?: (start: DeviceSignIn) => Promise<void>;
  confirm: (person: { name: string; fingerprint: string }) => Promise<boolean>;
  everyMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function signIn(o: LoginOpts, say: (line: string) => void): Promise<string> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const res = await fetchImpl(new URL("/v1/config", o.relay)).catch((err: unknown) => {
    throw new PairError(`couldn't reach ${o.relay}: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!res.ok) throw new PairError(`${o.relay} returned ${res.status}`);
  const config = (await res.json()) as { workosClientId?: string | null; dev?: boolean };
  if (config.dev) {
    const user = (o.user ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (!user) throw new PairError("this relay takes dev sign-in: kiwi login --user <the name your app signed in with>");
    return `dev:${user}`;
  }
  if (!config.workosClientId) throw new PairError(`${o.relay} has no sign-in, so this computer can't log in there`);
  const show =
    o.showSignIn ??
    (async ({ url, code }: DeviceSignIn) => {
      say(`sign in with the account your Channels app uses: open ${url}`);
      if (code) say(`and check it shows ${code}`);
    });
  const session = await workosDeviceSignIn(config.workosClientId, show, { fetchImpl });
  return session.access;
}

const ownerOf = (m: PairedMachine | null): { pk: string; name: string } | null => m?.device?.person ?? m?.person ?? (m?.cert ? { pk: m.cert.pk, name: "" } : null);

export async function loginComputer(o: LoginOpts): Promise<EnrolledDevice> {
  const say = o.say ?? ((line: string) => process.stdout.write(line + "\n"));
  const everyMs = o.everyMs ?? 1_500;
  const until = Date.now() + (o.timeoutMs ?? ENROLL_TTL_MS);
  const here = loadPairedMachine();
  const already = ownerOf(here);
  if (already)
    throw new PairError(
      `"${here?.label}" is already one of ${inlineText(already.name, 60) || "someone"}'s devices (key ${await personFingerprint(already.pk)}): run kiwi unpair first, then kiwi login`,
    );
  const fresh = await newMachine(o.relay);
  const m: PairedMachine = { ...fresh, label: here?.label ?? fresh.label };
  const token = await signIn(o, say);
  const client = accountClient(o.relay, async () => token, m.identity, o.fetchImpl);
  const { ask, nonce } = await askToEnroll(m.identity, { label: m.label, os: OS_NAMES[process.platform] ?? process.platform, as: "computer" });
  const id = await client.ask(ask).catch((err: unknown) => {
    throw new PairError(`the relay didn't take the ask: ${err instanceof Error ? err.message : String(err)}`);
  });
  say(`asked to add "${m.label}" to your devices: open Channels on your computer and approve it there.`);
  const wait = () => new Promise((r) => setTimeout(r, everyMs));
  const gone = () => new PairError(`your app turned "${m.label}" away, or the ask ran out; run kiwi login again to ask again`, 3);
  let seen: Enrollment | null = null;
  while (!seen) {
    if (Date.now() > until) {
      await client.drop(id).catch(() => {});
      throw new PairError(`nothing approved "${m.label}" in time; run kiwi login again to ask again`, 3);
    }
    const e = await client.enrollment();
    if (!e || e.id !== id) throw gone();
    if (e.answer) {
      if (!e.reveal) await client.reveal(id, nonce);
      seen = { ...e, reveal: { nonce, at: e.reveal?.at ?? Date.now() } };
      break;
    }
    await wait();
  }
  const digits = await enrollDigits(seen.ask, seen.answer!, nonce);
  say(`type these digits in your app: ${digits.slice(0, 3)} ${digits.slice(3)}`);
  const mailbox = await enrollMailbox(o.relay, m.identity, seen, o.fetchImpl);
  for (;;) {
    const raw = await mailbox.get<unknown>("b");
    if (raw !== null) {
      const grant = await readEnrollGrant(raw, m.identity.pk);
      if (!grant) throw new PairError("the app's grant didn't check out (another person's list, or a forged one); run kiwi login again");
      const name = inlineText(grant.person.name, 60) || "someone";
      const fingerprint = await personFingerprint(grant.person.pk);
      if (!(await o.confirm({ name, fingerprint }))) {
        await mailbox.drop().catch(() => {});
        throw new PairError(
          `kept nothing, so kiwi login can ask again with a new key. Your app may list "${m.label}" once more under this one: remove that entry. If your app never showed ${fingerprint}, someone else answered this computer's ask`,
        );
      }
      const taken = ownerOf(loadPairedMachine());
      if (taken) {
        await mailbox.drop().catch(() => {});
        throw new PairError(
          `kept nothing: while this login waited, "${m.label}" became one of ${inlineText(taken.name, 60) || "someone"}'s devices (key ${await personFingerprint(taken.pk)}). Your app may list it once more under the key this login asked with: remove that entry`,
        );
      }
      const device: EnrolledDevice = { person: grant.person, links: grant.links };
      saveMachine({ ...m, device, ...(grant.cert ? { cert: grant.cert, person: grant.person } : {}) });
      await mailbox.drop().catch(() => {});
      say(`"${m.label}" is one of ${name}'s devices now: its agents join your channels on their own and your app can start agents here. Kept in ${join(home(), "machine.json")}.`);
      return device;
    }
    if (Date.now() > until) throw new PairError(`nothing approved "${m.label}" in time; run kiwi login again to ask again`, 3);
    const still = await client.enrollment();
    if (!still || still.id !== id) {
      if ((await mailbox.get<unknown>("b")) === null) throw gone();
      continue;
    }
    await wait();
  }
}

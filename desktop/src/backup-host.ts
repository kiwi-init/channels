import { generatePassphrase, getBackup, putBackup, sealBackup } from "../../src/backup.ts";
import type { ChannelIdentityView, PersonView } from "./bridge.ts";

export interface BackupHostDeps {
  person: () => PersonView | null;
  channels: () => readonly ChannelIdentityView[];
  relay: () => string;
  token: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface BackupHost {
  status(): Promise<{ at: number } | null>;
  run(): Promise<{ passphrase: string; at: number }>;
}

export const NOT_SIGNED_IN = "Sign in first: the backup belongs to your account.";
export const NO_PERSON = "There is no person key on this computer to back up.";

export function createBackupHost(deps: BackupHostDeps): BackupHost {
  return {
    async status() {
      const token = await deps.token();
      if (!token) return null;
      const got = await getBackup(deps.relay(), token, deps.fetchImpl);
      return got ? { at: got.at } : null;
    },
    async run() {
      const person = deps.person();
      if (!person) throw new Error(NO_PERSON);
      const token = await deps.token();
      if (!token) throw new Error(NOT_SIGNED_IN);
      const passphrase = generatePassphrase();
      await putBackup(
        deps.relay(),
        token,
        await sealBackup(passphrase, { person, channels: deps.channels().map((c) => ({ ...c })) }),
        deps.fetchImpl,
      );
      return { passphrase, at: Date.now() };
    },
  };
}

// What a linked computer signs to vouch for an agent, shared by the CLI, the
// web app and both relays (so nothing here touches the file system).

import { verificationCode } from "./crypto.ts";

/** Requests about machines are signed like room requests, under this fixed scope. */
export const MACHINE_SCOPE = "kiwi-machines";

/** The statement a machine signs to vouch for one agent key in one channel (person.ts owns it now). */
export { vouchStatement } from "./person.ts";

/**
 * What a computer signs over its exchange key, so the link page can seat it in its person's channels:
 * the key they compare the code of vouches for the key the channel's keys get sealed to.
 */
export const xpkStatement = (pk: string, xpk: string) => `kiwi-machine-xpk\n${pk}\n${xpk}`;

/** The code a person compares between their terminal and the browser. */
export const machineCode = (pk: string) => verificationCode(MACHINE_SCOPE, pk);

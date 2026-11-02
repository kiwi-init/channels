import { sealTo } from "@kiwi/core/crypto.ts";
import { sign, type Identity } from "@kiwi/core/identity.ts";
import type { OldVault, Recovery, VaultContents } from "@kiwi/core/recovery.ts";

export interface OldBox {
  rxpk: string;
  box: string;
}

export async function oldPersonBox(recovery: Recovery, person: Identity): Promise<OldBox> {
  return { rxpk: recovery.rxpk, box: await sealTo(recovery.rxpk, JSON.stringify(person), `kiwi-vault-person\n${recovery.person}\n${recovery.rxpk}`) };
}

export async function oldVault(
  signer: Identity,
  recovery: Recovery,
  version: number,
  contents: { person: Identity | OldBox; channels: VaultContents["channels"] },
  at = Date.now(),
): Promise<OldVault> {
  const inner = { person: "box" in contents.person ? contents.person.box : contents.person, channels: contents.channels };
  const box = await sealTo(recovery.rxpk, JSON.stringify(inner), `kiwi-vault\n${recovery.person}\n${version}\n${at}`);
  return sign(signer, { kind: "kiwi-vault" as const, v: 1 as const, person: recovery.person, version, at, box });
}

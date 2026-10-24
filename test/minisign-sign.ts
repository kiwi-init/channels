import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export interface ThrowawayKey {
  publicKey: string;
  sign(data: Uint8Array | string, comment?: string): string;
}

export function throwawayKey(): ThrowawayKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  return {
    publicKey: Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64"),
    sign: (data, comment = "a throwaway key's signature") => {
      const signature = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
      const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      return `untrusted comment: signature from a throwaway key\n${Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`;
    },
  };
}

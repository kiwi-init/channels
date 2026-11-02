import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TRUSTED = "trusted comment: ";

interface PublicKey {
  id: Buffer;
  key: KeyObject;
}

const decoded = (text: string | undefined, bytes: number): Buffer | null => {
  const t = text?.trim();
  if (!t || !BASE64.test(t)) return null;
  const raw = Buffer.from(t, "base64");
  return raw.length === bytes ? raw : null;
};

function readPublicKey(text: string): PublicKey | null {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("untrusted comment:"))
    .at(-1);
  const raw = decoded(line, 42);
  if (!raw || raw.subarray(0, 2).toString("latin1") !== "Ed") return null;
  return { id: raw.subarray(2, 10), key: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.subarray(10).toString("base64url") }, format: "jwk" }) };
}

export function minisignVerifies(data: Uint8Array, signature: string, publicKey: string): boolean {
  const pk = readPublicKey(publicKey);
  const [untrusted, sigLine, trustedLine, globalLine] = signature.replace(/\r/g, "").split("\n");
  if (!pk || !untrusted?.startsWith("untrusted comment:") || !trustedLine?.startsWith(TRUSTED)) return false;
  const sig = decoded(sigLine, 74);
  const global = decoded(globalLine, 64);
  if (!sig || !global || !sig.subarray(2, 10).equals(pk.id)) return false;
  const alg = sig.subarray(0, 2).toString("latin1");
  if (alg !== "ED" && alg !== "Ed") return false;
  const signed = alg === "ED" ? createHash("blake2b512").update(data).digest() : Buffer.from(data);
  const bytes = sig.subarray(10);
  if (!verify(null, signed, pk.key, bytes)) return false;
  return verify(null, Buffer.concat([bytes, Buffer.from(trustedLine.slice(TRUSTED.length), "utf8")]), pk.key, global);
}

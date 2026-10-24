import fs from "node:fs";

import { minisignVerifies } from "../src/minisign.ts";
import { RELEASE_KEY } from "../src/release-key.ts";

const [sums, signature] = process.argv.slice(2);
if (!sums || !signature) {
  console.error("usage: bun desktop/scripts/verify-sums.ts SHA256SUMS SHA256SUMS.minisig");
  process.exit(2);
}
if (!minisignVerifies(fs.readFileSync(sums), fs.readFileSync(signature, "utf8"), RELEASE_KEY)) {
  console.error(
    `${signature} doesn't verify ${sums} with the release key pinned in desktop/src/release-key.ts: the MINISIGN_SECRET_KEY secret and that key must be one pair, or no Linux app takes this release`,
  );
  process.exit(1);
}
console.log(`${signature} verifies ${sums} with the pinned release key`);

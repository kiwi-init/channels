import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DICTATION_FILES, sha256Hex } from "@kiwi/core/dictation.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun scripts/dictation-files.ts <dir>   (the pinned dictation files, each named by its SHA-256)");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

for (const [name, file] of Object.entries(DICTATION_FILES)) {
  const path = join(dir, file.sha256);
  if (existsSync(path) && (await sha256Hex(new Uint8Array(readFileSync(path)))) === file.sha256) {
    console.log(`kept     ${name}`);
    continue;
  }
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`${name}: ${file.url} answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength !== file.size || (await sha256Hex(bytes)) !== file.sha256) throw new Error(`${name}: what ${file.url} sent doesn't match its pinned size and SHA-256`);
  writeFileSync(`${path}.part`, bytes);
  renameSync(`${path}.part`, path);
  console.log(`fetched  ${name}`);
}

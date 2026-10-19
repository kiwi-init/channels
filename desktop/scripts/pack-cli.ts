import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

const bin = process.argv[2] ? resolve(process.argv[2]) : "";
if (!bin) {
  console.error("usage: bun desktop/scripts/pack-cli.ts <kiwi binary>  (writes <kiwi binary>.zst beside it)");
  process.exit(2);
}
const raw = readFileSync(bin);
const packed = zstdCompressSync(raw, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
if (!zstdDecompressSync(packed).equals(raw)) {
  console.error("pack-cli: the packed binary doesn't unpack to the same bytes");
  process.exit(1);
}
writeFileSync(`${bin}.zst`, packed);
console.log(`pack-cli: ${(raw.length / 1048576).toFixed(1)}MiB to ${(packed.length / 1048576).toFixed(1)}MiB (${bin}.zst)`);

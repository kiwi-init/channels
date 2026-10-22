import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

if (process.argv[2] === "--unpack") {
  const [from, to] = [process.argv[3], process.argv[4]];
  if (!from || !to) {
    console.error("usage: bun desktop/scripts/pack-cli.ts --unpack <kiwi.zst> <out>");
    process.exit(2);
  }
  writeFileSync(resolve(to), zstdDecompressSync(readFileSync(resolve(from))), { mode: 0o755 });
  process.exit(0);
}
const bin = process.argv[2] ? resolve(process.argv[2]) : "";
if (!bin) {
  console.error("usage: bun desktop/scripts/pack-cli.ts <kiwi binary>  (writes <kiwi binary>.zst beside it), or --unpack <kiwi.zst> <out>");
  process.exit(2);
}
const raw = readFileSync(bin);
const packed = zstdCompressSync(raw, { params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_nbWorkers]: availableParallelism() } });
if (!zstdDecompressSync(packed).equals(raw)) {
  console.error("pack-cli: the packed binary doesn't unpack to the same bytes");
  process.exit(1);
}
writeFileSync(`${bin}.zst`, packed);
console.log(`pack-cli: ${(raw.length / 1048576).toFixed(1)}MiB to ${(packed.length / 1048576).toFixed(1)}MiB (${bin}.zst)`);

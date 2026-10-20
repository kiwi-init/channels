import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join, resolve } from "node:path";

const KiB = 1024;
const MAX_BLOCK = 128 * KiB;
const COMPRESSORS: Record<number, string> = { 1: "gzip", 2: "lzma", 3: "lzo", 4: "xz", 5: "lz4", 6: "zstd" };
const FAST = new Set(["gzip", "lz4", "zstd"]);

const dir = resolve(process.argv[2] ?? "desktop/release");

function read(fd: number, at: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  if (readSync(fd, buf, 0, length, at) !== length) throw new Error(`short read at ${at}`);
  return buf;
}

function squashfs(path: string): { compressor: string; block: number } {
  const fd = openSync(path, "r");
  try {
    const elf = read(fd, 0, 64);
    if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2) throw new Error("not a 64-bit ELF runtime");
    const offset = Number(elf.readBigUInt64LE(0x28)) + elf.readUInt16LE(0x3a) * elf.readUInt16LE(0x3c);
    const sb = read(fd, offset, 24);
    if (sb.toString("latin1", 0, 4) !== "hsqs") throw new Error(`no squashfs superblock at ${offset}`);
    const id = sb.readUInt16LE(20);
    return { compressor: COMPRESSORS[id] ?? `unknown (${id})`, block: sb.readUInt32LE(12) };
  } finally {
    closeSync(fd);
  }
}

const images = readdirSync(dir).filter((n) => n.endsWith(".AppImage"));
if (!images.length) {
  console.error(`appimage: no .AppImage under ${dir}`);
  process.exit(1);
}
let bad = 0;
for (const name of images) {
  try {
    const { compressor, block } = squashfs(join(dir, name));
    const ok = FAST.has(compressor) && block <= MAX_BLOCK;
    console.log(
      `${name}: ${compressor}, ${block / KiB} KiB blocks${ok ? "" : ` (needs gzip, lz4 or zstd with blocks up to ${MAX_BLOCK / KiB} KiB: the app pages in from this image at every launch)`}`,
    );
    if (!ok) bad++;
  } catch (err) {
    console.error(`appimage: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    bad++;
  }
}
process.exit(bad ? 1 : 0);

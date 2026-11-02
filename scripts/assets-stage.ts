import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ANYDOC_ASSET, ANYDOC_VERSION, ANYDOC_WASM_SHA256 } from "../src/received-files.ts";

const ROOT = resolve(import.meta.dir, "..");
const PACKAGE = join(ROOT, "node_modules/@firecrawl/anydoc-wasm");

export function stagedAnydoc(): { name: string; bytes: Uint8Array } {
  const manifest: unknown = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8"));
  const version = typeof manifest === "object" && manifest !== null && "version" in manifest ? manifest.version : undefined;
  if (version !== ANYDOC_VERSION) throw new Error(`@firecrawl/anydoc-wasm is ${String(version)} but src/received-files.ts pins ${ANYDOC_VERSION}`);
  const bytes = new Uint8Array(readFileSync(join(PACKAGE, "anydoc_wasm_bg.wasm")));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== ANYDOC_WASM_SHA256) throw new Error(`anydoc_wasm_bg.wasm hashes to ${sha} but src/received-files.ts pins ${ANYDOC_WASM_SHA256}`);
  return { name: ANYDOC_ASSET, bytes };
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? "dist/assets");
  const { name, bytes } = stagedAnydoc();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), bytes);
  console.log(`staged ${join(out, name)} (${bytes.length} bytes, sha256 ${ANYDOC_WASM_SHA256})`);
}

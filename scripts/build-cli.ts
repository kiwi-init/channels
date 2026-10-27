import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { COMMANDS } from "../src/sh.ts";
import { CLI_COMPILE, coverageChunks, heavyIn, mcpValidatorStub, registryEntries, stubbedChunks, stubPlugin, validatorsIn } from "./cli-bundle.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUDGET_BYTES = 2_800_000;
const TARGETS = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64", "bun-linux-arm64"] as const satisfies readonly Bun.Build.CompileTarget[];

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    outfile: { type: "string", default: "dist/kiwi" },
    check: { type: "boolean", default: false },
    js: { type: "string" },
  },
});

const target = values.target === undefined ? undefined : TARGETS.find((t) => t === values.target);
if (values.target !== undefined && target === undefined) {
  console.error(`unknown --target ${values.target} (one of: ${TARGETS.join(", ")})`);
  process.exit(2);
}

const registry = await Bun.file(join(ROOT, "node_modules/just-bash/dist/bundle/index.js")).text();
const stubbed = stubbedChunks(registryEntries(registry), new Set(COMMANDS), coverageChunks(registry));
const shared = {
  entrypoints: [join(ROOT, "src/cli/main.ts")],
  minify: true,
  splitting: true,
  external: ["node-liblzma", "@mongodb-js/zstd"],
  plugins: [stubPlugin(stubbed), mcpValidatorStub()],
};

function failed(result: Bun.BuildOutput): boolean {
  for (const log of result.logs) console.error(log);
  return !result.success;
}

if (values.check) {
  const outdir = mkdtempSync(join(tmpdir(), "kiwi-cli-check-"));
  try {
    const result = await Bun.build({ ...shared, target: "bun", sourcemap: "external", outdir });
    if (failed(result)) process.exit(1);
    const code = result.outputs.filter((o) => o.kind === "entry-point" || o.kind === "chunk");
    const bytes = code.reduce((sum, o) => sum + o.size, 0);
    const entry = code.find((o) => o.kind === "entry-point")?.size ?? 0;
    const sources: string[] = [];
    for (const o of result.outputs.filter((o) => o.kind === "sourcemap")) {
      const map: unknown = await o.json();
      if (typeof map === "object" && map !== null && "sources" in map && Array.isArray(map.sources)) sources.push(...map.sources.filter((s): s is string => typeof s === "string"));
    }
    const heavy = heavyIn(sources);
    const validators = validatorsIn(sources);
    console.log(`kiwi JS: ${bytes} bytes in ${code.length} files, ${entry} in the entry (budget ${BUDGET_BYTES}), ${stubbed.size} just-bash command chunks left out`);
    if (heavy.length) console.error(`the CLI bundle contains ${heavy.join(", ")}: only kiwi sh's allowed commands may be bundled`);
    if (validators.length) console.error(`the CLI bundle contains ${validators.join(", ")}: the MCP SDK's JSON Schema validator is stubbed out (scripts/cli-bundle.ts), so something else imports it`);
    if (bytes > BUDGET_BYTES) console.error(`the CLI bundle is ${bytes} bytes, over its ${BUDGET_BYTES}-byte budget`);
    if (heavy.length || validators.length || bytes > BUDGET_BYTES) process.exit(1);
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
} else if (values.js !== undefined) {
  const outfile = resolve(values.js);
  const result = await Bun.build({ ...shared, splitting: false, target: "bun" });
  if (failed(result)) process.exit(1);
  const [out, ...more] = result.outputs;
  if (!out || more.length) {
    console.error(`expected the CLI as one JS file, got ${result.outputs.length}`);
    process.exit(1);
  }
  await Bun.write(outfile, out);
  console.log(`built ${outfile}: the CLI as one JS file, ${out.size} bytes, for the app to compile with its own Bun`);
} else {
  const outfile = resolve(values.outfile);
  const result = await Bun.build({ ...shared, compile: { ...CLI_COMPILE, ...(target === undefined ? {} : { target }), outfile } });
  if (failed(result)) process.exit(1);
  console.log(`built ${outfile}${target ? ` for ${target}` : ""}, ${stubbed.size} just-bash command chunks left out`);
}

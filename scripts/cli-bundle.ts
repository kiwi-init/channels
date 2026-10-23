import type { BunPlugin } from "bun";

const ENTRY = /name:"([a-z0-9_.-]+)",load:async\(\)=>\(await import\("\.\/chunks\/([A-Za-z0-9_-]+\.js)"\)\)/g;

export interface RegistryEntry {
  name: string;
  chunk: string;
}

export function registryEntries(source: string): RegistryEntry[] {
  return [...source.matchAll(ENTRY)].map(([, name = "", chunk = ""]) => ({ name, chunk }));
}

const COVERAGE = /import\("\.\/chunks\/(flag-coverage-[A-Za-z0-9_-]+\.js)"\)/g;

export function coverageChunks(source: string): string[] {
  return [...source.matchAll(COVERAGE)].map(([, chunk = ""]) => chunk);
}

export function stubbedChunks(entries: RegistryEntry[], allowed: ReadonlySet<string>, extra: string[] = []): Set<string> {
  const kept = new Set(entries.filter((e) => allowed.has(e.name)).map((e) => e.chunk));
  return new Set([...entries.map((e) => e.chunk).filter((chunk) => !kept.has(chunk)), ...extra]);
}

const SH_PROBES: Record<string, string> = {
  date: "date -u -d @0 +%Y",
  seq: "seq 3",
  expr: "expr 1 + 1",
  xargs: "echo a b | xargs echo",
  which: "which cat",
  printf: "printf '%s\\n' x",
  echo: "echo hi",
  jq: "jq -c 'keys' /channel/status.json",
  yq: "yq '.' /channel/status.json",
  join: "join /channel/README /channel/README",
  comm: "comm /channel/README /channel/README",
  diff: "diff /channel/README /channel/README",
  paste: "paste /channel/README /channel/README",
  readlink: "readlink -f /channel/README",
  basename: "basename /channel/README",
  dirname: "dirname /channel/README",
  stat: "stat -c %s /channel/README",
};

export const shProbe = (command: string): string => SH_PROBES[command] ?? `${command} /channel/README`;

export const CLI_COMPILE = { autoloadBunfig: false, autoloadDotenv: false } as const;

export const HEAVY = ["run", "sql.js", "turndown", "@mixmark-io/domino"] as const;

export function heavyIn(sources: string[]): string[] {
  return HEAVY.filter((pkg) => sources.some((source) => source.includes(`node_modules/${pkg}/`)));
}

export function stubPlugin(stubbed: ReadonlySet<string>): BunPlugin {
  return {
    name: "stub-sh-commands",
    setup(build) {
      build.onResolve({ filter: /^\.\/chunks\/[A-Za-z0-9_-]+\.js$/ }, (args) => {
        const chunk = args.path.slice("./chunks/".length);
        if (!args.importer.includes("/just-bash/") || !stubbed.has(chunk)) return undefined;
        return { path: chunk, namespace: "sh-stub" };
      });
      build.onLoad({ filter: /.*/, namespace: "sh-stub" }, () => ({ contents: "export {}", loader: "js" }));
    },
  };
}

const AJV_PROVIDER = /[\\/]@modelcontextprotocol[\\/]sdk[\\/]dist[\\/](?:esm|cjs)[\\/]validation[\\/]ajv-provider\.js$/;

export const NO_SCHEMA_VALIDATOR = "kiwi's MCP server asks clients for no structured input (elicitation), so it bundles no JSON Schema validator";

export const VALIDATORS = ["ajv", "ajv-formats", "fast-uri"] as const;

export function validatorsIn(sources: string[]): string[] {
  return VALIDATORS.filter((pkg) => sources.some((source) => source.includes(`node_modules/${pkg}/`)));
}

export function mcpValidatorStub(): BunPlugin {
  return {
    name: "stub-mcp-ajv",
    setup(build) {
      build.onLoad({ filter: AJV_PROVIDER }, () => ({
        contents: `export class AjvJsonSchemaValidator { getValidator() { throw new Error(${JSON.stringify(NO_SCHEMA_VALIDATOR)}); } }`,
        loader: "js",
      }));
    },
  };
}

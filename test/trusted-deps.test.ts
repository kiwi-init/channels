import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STORE = join(ROOT, "node_modules/.bun");
const HOOKS = ["preinstall", "install", "postinstall"] as const;
const BLOCKED = ["react-native-enriched-markdown"];

interface Manifest {
  name?: unknown;
  scripts?: Record<string, unknown>;
  trustedDependencies?: unknown;
}

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8")) as Manifest;

function packageDirs(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(STORE)) {
    const nm = join(STORE, entry, "node_modules");
    if (!existsSync(nm)) continue;
    for (const top of readdirSync(nm)) {
      const names = top.startsWith("@") ? readdirSync(join(nm, top)).map((n) => join(top, n)) : [top];
      for (const name of names) if (existsSync(join(nm, name, "package.json"))) out.push(join(nm, name));
    }
  }
  return out;
}

function withInstallScripts(): string[] {
  const names = new Set<string>();
  for (const dir of packageDirs()) {
    const m = readManifest(join(dir, "package.json"));
    if (typeof m.name === "string" && HOOKS.some((h) => typeof m.scripts?.[h] === "string")) names.add(m.name);
  }
  return [...names].sort();
}

describe("dependency install scripts", () => {
  test("run only for the packages package.json trusts; any other is a known, blocked one", () => {
    const listed = readManifest(join(ROOT, "package.json")).trustedDependencies;
    const trusted = Array.isArray(listed) ? listed.filter((t): t is string => typeof t === "string") : [];
    expect(trusted.length).toBeGreaterThan(0);
    const allowed = new Set([...trusted, ...BLOCKED]);
    expect(withInstallScripts().filter((name) => !allowed.has(name))).toEqual([]);
  });
});

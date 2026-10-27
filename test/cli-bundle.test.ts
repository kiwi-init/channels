import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CLI_COMPILE, mcpValidatorStub, NO_SCHEMA_VALIDATOR, validatorsIn } from "../scripts/cli-bundle.ts";

const ROOT = resolve(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "kiwi-cli-bundle-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("the CLI bundle's MCP server", () => {
  test("bundles no JSON Schema validator: the server still starts and answers, and asking it to validate says why it can't", async () => {
    const entry = join(work, "mcp-entry.ts");
    writeFileSync(
      entry,
      `import { McpServer } from ${JSON.stringify(join(ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js"))}\n` +
        `const server = new McpServer({ name: "kiwi", version: "1" })\n` +
        `server.registerTool("ping", { description: "ping" }, async () => ({ content: [{ type: "text", text: "pong" }] }))\n` +
        `let said = ""\n` +
        `try { server.server._jsonSchemaValidator.getValidator({ type: "object" }) } catch (err) { said = err.message }\n` +
        `console.log(JSON.stringify({ said }))\n`,
    );
    const built = await Bun.build({ entrypoints: [entry], target: "bun", outdir: join(work, "mcp-out"), sourcemap: "external", plugins: [mcpValidatorStub()] });
    expect(built.success).toBe(true);
    const map: unknown = await Bun.file(join(work, "mcp-out", "mcp-entry.js.map")).json();
    const sources = typeof map === "object" && map !== null && "sources" in map && Array.isArray(map.sources) ? map.sources.filter((s): s is string => typeof s === "string") : [];
    expect(sources.some((s) => s.includes("@modelcontextprotocol/sdk/"))).toBe(true);
    expect(validatorsIn(sources)).toEqual([]);
    const proc = Bun.spawn(["bun", join(work, "mcp-out", "mcp-entry.js")], { stdout: "pipe", stderr: "pipe" });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ said: NO_SCHEMA_VALIDATOR });
  }, 60_000);

  test("without the stub the SDK pulls in ajv, so the check has something to catch", () => {
    expect(validatorsIn(["../node_modules/ajv/dist/core.js", "../node_modules/ajv-formats/dist/index.js", "../node_modules/zod/v4/core/api.js"])).toEqual(["ajv", "ajv-formats"]);
  });
});

test.skipIf(process.platform === "win32")(
  "a kiwi compiled as scripts/build-cli.ts compiles it loads no bunfig.toml or .env from the folder it starts in, so a project there can't preload code into it or set its environment (T1365)",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-autoload-"));
    try {
      const probe = join(dir, "probe.js");
      writeFileSync(probe, 'console.log(process.env["KIWI_FROM_DOTENV"] ?? "no .env");\n');
      const bin = join(dir, "probe");
      const built = await Bun.build({ entrypoints: [probe], compile: { ...CLI_COMPILE, outfile: bin } });
      expect(built.success).toBe(true);
      const project = join(dir, "project");
      mkdirSync(project);
      writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
      writeFileSync(join(project, "preload.js"), 'require("node:fs").writeFileSync("preload-ran", "");\n');
      writeFileSync(join(project, ".env"), "KIWI_FROM_DOTENV=1\n");
      const out = execFileSync(bin, [], { cwd: project, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: dir } });
      expect({ out: out.trim(), preloaded: existsSync(join(project, "preload-ran")) }).toEqual({ out: "no .env", preloaded: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  60_000,
);

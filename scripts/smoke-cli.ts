import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startRelay } from "../src/relay/bun.ts";
import { COMMANDS } from "../src/sh.ts";
import { kiwiCmd } from "../test/owner.ts";
import { shProbe } from "./cli-bundle.ts";

const binary = resolve(process.argv[2] ?? "dist/kiwi");
const made: string[] = [];
const scratch = (tag: string) => {
  const dir = mkdtempSync(join(tmpdir(), `kiwi-smoke-cli-${tag}-`));
  made.push(dir);
  return dir;
};
const dataDir = scratch("relay");
const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
const relay = server.url.origin;
const owner = scratch("owner");
const agent = scratch("agent");

function spawn(cmd: string[], home: string) {
  return Bun.spawn(cmd, { cwd: home, env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

async function run(cmd: string[], home: string) {
  const p = spawn(cmd, home);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(cmd: string[], home: string): Promise<string> {
  const r = await run(cmd, home);
  if (r.code !== 0) throw new Error(`${cmd.slice(-3).join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

function check(what: string, pass: boolean, detail = ""): void {
  if (!pass) throw new Error(`${what}${detail ? `: ${detail}` : ""}`);
  console.log(`ok  ${what}`);
}

try {
  check("--version", (await ok([binary, "--version"], agent)).trim().length > 0);

  const code = /join code: (\S+)/.exec(await ok(kiwiCmd(["create", "smoke", "--as", "lead", "--open"]), owner))?.[1];
  if (!code) throw new Error("no join code");
  const joining = spawn([binary, "join", code, "--as", "dev", "--model", "claude-sonnet-5-5"], agent);
  let request: string | undefined;
  for (let i = 0; i < 300 && !request && joining.exitCode === null; i++) {
    request = /(\d{3}-\d{3})/.exec(await ok(kiwiCmd(["--as", "human", "requests"]), owner))?.[1];
    if (!request) await Bun.sleep(50);
  }
  if (!request) {
    joining.kill();
    const [out, err] = await Promise.all([new Response(joining.stdout).text(), new Response(joining.stderr).text()]);
    throw new Error(`the join request never showed; kiwi join said:\n${out}\n${err}`);
  }
  await ok(kiwiCmd(["--as", "human", "approve", request, "--yes"]), owner);
  check("join, from the binary", (await joining.exited) === 0);

  const marker = "@@kiwi-smoke@@";
  const script = COMMANDS.map((c) => `echo '${marker} ${c}'; ${shProbe(c)}; echo "${marker} exit $?"`).join("\n");
  const fromBinary = await run([binary, "sh", script], agent);
  const fromSource = await run(kiwiCmd(["sh", script]), agent);
  check("kiwi sh runs", fromBinary.code === 0 && fromBinary.out.includes(`${marker} help`), fromBinary.err);
  check(`kiwi sh: all ${COMMANDS.length} commands answer as they do from source`, fromBinary.out === fromSource.out && fromBinary.err === fromSource.err, fromBinary.err);
  check("kiwi sh: none is missing", !/exit 127/.test(fromBinary.out));

  const rpc = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sh", arguments: { script: "cat /channel/README | head -1" } } },
  ];
  const mcp = Bun.spawn([binary, "mcp"], { cwd: agent, env: { ...process.env, KIWI_HOME: agent, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  for (const message of rpc) mcp.stdin.write(JSON.stringify(message) + "\n");
  await mcp.stdin.flush();
  let mcpOut = "";
  const reader = mcp.stdout.getReader();
  const decoder = new TextDecoder();
  const until = Date.now() + 15_000;
  while (!mcpOut.includes('"id":2') && Date.now() < until) {
    const { value, done } = await reader.read();
    if (done) break;
    mcpOut += decoder.decode(value);
  }
  mcp.kill();
  check("kiwi mcp: the sh tool answers", mcpOut.includes('"id":2') && mcpOut.includes("Channel files"), mcpOut.slice(0, 400));

  const doctor = await run([binary, "doctor"], agent);
  check("kiwi doctor runs", /version/.test(doctor.out), doctor.err);
  console.log("CLI smoke passed");
} finally {
  server.stop(true);
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
}

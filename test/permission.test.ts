import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { looksSecret, PERMISSION_CHOICES, permissionAnswer, permissionShown, wellFormedPermission, type PermissionShown } from "@kiwi/core/permission.ts";
import { wellFormed, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";

const NONCE = "n0nce_Abc-123";
const CWD = "/Users/ana/code/kiwi";
const LATER = Date.now() + 600_000;
const LETTERS = "QmLaVbTwKcYnRsHfJuEdGgXoNiAqMPzTrBkWyCeUjSl";
const RANDOM = "Zx8Qm3pLa9VbT2wKcY7nR4sHfJ1uE6dGgXoNiAqM0Pz";
const SHA40 = "9fceb02d0ae598e95dc970b74767f19372d61af8";
const HEX64 = "3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed";
const join = (...parts: string[]) => parts.join("");
const ghp = join("gh", "p_", LETTERS.slice(0, 36));

const shown = (tool_name: unknown, tool_input: unknown, more: { cwd?: unknown; mcp_server?: unknown } = {}) => permissionShown({ tool_name, tool_input, cwd: CWD, ...more }, NONCE, LATER);

const SECRET: [string, string][] = [
  ["a GitHub token in an export", `export GITHUB_TOKEN=${ghp}`],
  ["a fine-grained GitHub token", join("gh auth status --hostname github.com github_", "pat_", LETTERS.slice(0, 30))],
  ["an OpenAI-style key", join("OPENAI=sk-", "proj-", LETTERS.slice(0, 30))],
  ["a Stripe live key", join("stripe charges list --live sk_", "live_", LETTERS.slice(0, 24))],
  ["a Slack bot token", join("SLACK=xox", "b-1234567890-", LETTERS.slice(0, 20))],
  ["an AWS access key id", join("aws configure set aws_access_key_id AKIA", "IOSFODNN7EXAMPLE")],
  ["a Google API key", join('curl "https://maps.googleapis.com/maps/api/geocode/json?key=AIza', "Sy", LETTERS.slice(0, 33), '"')],
  ["a GitLab token", join("GL=glpat-", LETTERS.slice(0, 20))],
  ["an npm _authToken", "npm config set //registry.npmjs.org/:_authToken=abc123"],
  ["a JWT", join("echo eyJ", "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl")],
  ["a PEM private key", join("cat > id <<'EOF'\n-----BEGIN ", "OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n-----END OPENSSH PRIVATE KEY-----\nEOF")],
  ["an Authorization header with a Bearer token", `curl -H 'Authorization: Bearer ${LETTERS.slice(0, 32)}' https://api.example.com`],
  ["a Bearer token alone", `http GET api.example.com "Bearer ${LETTERS.slice(0, 20)}"`],
  ["an X-Api-Key header", `curl -H X-Api-Key:${LETTERS.slice(0, 24)} https://api.example.com`],
  ["a Cookie header", `curl -H "Cookie: session=${LETTERS.slice(0, 24)}" https://example.com`],
  ["a PRIVATE-TOKEN header", "curl -H 'PRIVATE-TOKEN: abcdefgh' https://gitlab.example.com/api/v4/user"],
  ["a --password flag", "pg_dump --password=hunter2 shop"],
  ["a --token flag", "vault login --token s.abcdefgh"],
  ["an --api-key flag", "stripe --api-key abc12345 charges list"],
  ["mysql -p<secret>", "mysql -u root -pS3cretPass shop"],
  ["mysqldump -p'<secret>'", "mysqldump -uroot -p'hunter2' shop > shop.sql"],
  ["sshpass -p", "sshpass -p hunter2 ssh deploy@10.0.0.5"],
  ["docker login -p", "docker login -u bot -p hunter2 registry.example.com"],
  ["redis-cli -a", "redis-cli -h cache -a hunter2 ping"],
  ["curl -u user:pass", "curl -u admin:hunter2 https://ci.example.com/api/json"],
  ["kubectl --from-literal=password=", "kubectl create secret generic db --from-literal=password=hunter2"],
  ["kubectl secret --from-literal", "kubectl create secret generic api --from-literal=value=abc"],
  ["a _PASSWORD= assignment", "DB_PASSWORD=hunter2 bun run migrate"],
  ["a _SECRET= assignment", "export JWT_SECRET=correcthorse"],
  ["a _PASS= assignment", "SMTP_PASS=hunter2 node mail.js"],
  ["a DATABASE_URL= assignment", "DATABASE_URL=postgres://localhost/shop bun run migrate"],
  ["PGPASSWORD=", "PGPASSWORD=hunter2 psql -h db shop"],
  ["api_key in a query string", 'curl "https://api.example.com/v1/items?api_key=abc123"'],
  ["a password in JSON", `curl -d '{"user":"ana","password":"hunter2"}' https://example.com/login`],
  ["a token in a YAML heredoc", "cat > config.yml <<'EOF'\nservice: ci\ntoken: abc123\nEOF"],
  ["a postgres URL with a password", "psql postgres://shop:hunter2@db.example.com/shop"],
  ["an https URL with user and token", `git clone https://ana:${ghp}@github.com/ana/repo.git`],
  ["an https URL with a token as its user", `git clone https://${LETTERS.slice(0, 20)}@github.com/ana/repo.git`],
  ["a redis URL with a password", "redis-cli -u redis://default:hunter2@cache:6379 ping"],
  ["a Slack webhook", join("curl -X POST https://hooks.slack", ".com/services/T0000/B0000/", LETTERS.slice(0, 24))],
  ["a Discord webhook", join("curl https://discord", ".com/api/webhooks/123456/", LETTERS.slice(0, 30))],
  ["a Telegram bot token", join("curl https://api.telegram.org/bot123456789:", "AA", LETTERS.slice(0, 33), "/getMe")],
  ["a heredoc writing .env", "cat > .env <<'EOF'\nPORT=3000\nEOF"],
  ["a heredoc appending to .env.local", "cat <<EOF >> apps/web/.env.local\nNEXT_PUBLIC_X=1\nEOF"],
  ["tee into .env", 'echo "X=1" | tee .env'],
  ["64 hex characters", `echo ${HEX64}`],
  ["41 hex characters", `echo ${SHA40}a`],
  ["a 0x private key", `cast wallet address --private-key 0x${HEX64}`],
  ["a long random base64 run", "echo wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
  ["a long random base64url run", `export SEED=${RANDOM}`],
  ["a long random lowercase-and-digits run", "echo k3j9x2m7q8w1e4r6t5y0u2i9o8p7a6s5d4f3g2h1"],
];

const NOT_SECRET: [string, string][] = [
  ["git log", "git log -1"],
  ["bun test", "bun test"],
  ["rm -rf", "rm -rf dist"],
  ["a git SHA", `git show ${SHA40}`],
  ["listing ~/.ssh", "ls ~/.ssh"],
  ["mkdir -p and cp -pr", "mkdir -p dist && cp -pr assets dist"],
  ["git log -p", "git log -p -3 src/permission.ts"],
  ["mysql asking for its password", "mysql -u root -p shop"],
  ["psql asking for its password", "psql --password -h db shop"],
  ["docker login from stdin", "echo $T | docker login -u bot --password-stdin ghcr.io"],
  ["gh auth from a file", "gh auth login --with-token < token.txt"],
  ["a uid:gid", "docker run -u 1000:1000 node:22 bun test"],
  ["git push -u", "git push -u origin T1454-permission-core"],
  ["an image digest", `docker pull node@sha256:${HEX64}`],
  ["a checksum check", `echo "${HEX64}  dist.tgz" | shasum -a 256 -c`],
  ["an SRI hash", `npm view kiwi dist.integrity | grep sha512-${RANDOM}${RANDOM}==`],
  ["an agent's scratch folder", "cd /private/tmp/claude-501/-Users-jow-www-channels/4618d666-b201-4923-be79-c575c22f3e08/scratchpad/T1454"],
  ["a path with a year in it", "ls /Users/jonathan/Documents/ProjectsArchive2024/SomeRepository"],
  ["a 40-hex folder in a path", `ls /tmp/${SHA40}/Work`],
  ["tokens and tokenizers", "TOKENIZERS_PARALLELISM=false python train.py --max_tokens=4096"],
  ["a branch name", "git checkout -b T1454-permission-core"],
  ["reading a secret's YAML", "kubectl get secret db -o yaml"],
  ["a configmap literal", "kubectl create configmap app --from-literal=mode=fast"],
  ["copying the env example", "cp .env.example .env"],
  ["a URL with a query", "curl -s 'https://api.github.com/repos/ana/kiwi/pulls?state=open'"],
  ["an ssh remote", "git clone ssh://git@github.com/ana/repo.git"],
  ["grepping for the word", 'grep -rn "password" src'],
  ["a make variable", "make BYPASS_CACHE=1 build"],
  ["a long identifier", "grep -rn AbstractSingletonProxyFactoryBeanConfigurationProvider src"],
  ["a separator line", "echo ----------------------------------------------"],
  ["bearer as a word", 'echo "uses bearer authentication"'],
  ["PATH", "export PATH=$HOME/.bun/bin:$PATH"],
];

describe("what a permission prompt shows", () => {
  test("Bash: the command and its description", () => {
    expect(shown("Bash", { command: "bun test test/permission.test.ts", description: "Run the permission tests", timeout: 60_000 })).toEqual({
      tool: "Bash",
      command: "bun test test/permission.test.ts",
      description: "Run the permission tests",
      cwd: CWD,
      nonce: NONCE,
      expiresAt: LATER,
      canAllow: true,
    });
    expect(shown("Bash", { command: "ls" })).toEqual({ tool: "Bash", command: "ls", cwd: CWD, nonce: NONCE, expiresAt: LATER, canAllow: true });
  });

  test("Bash outside the sandbox can only be denied; a background run says so", () => {
    expect(shown("Bash", { command: "bun run build", dangerouslyDisableSandbox: true, run_in_background: true })).toMatchObject({ sandbox: "off", background: true, canAllow: false });
    const sandboxed = shown("Bash", { command: "bun run build", dangerouslyDisableSandbox: false, run_in_background: false });
    expect(sandboxed).toMatchObject({ canAllow: true });
    expect(sandboxed).not.toHaveProperty("sandbox");
    expect(sandboxed).not.toHaveProperty("background");
  });

  test("edits: the paths and what is written, never what is replaced", () => {
    const edit = shown("Edit", { file_path: "/Users/ana/code/kiwi/src/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" });
    expect(edit).toEqual({ tool: "Edit", paths: ["/Users/ana/code/kiwi/src/a.ts"], content: "const a = 2;", cwd: CWD, nonce: NONCE, expiresAt: LATER, canAllow: true });
    expect(JSON.stringify(edit)).not.toContain("const a = 1");
    expect(shown("Write", { file_path: "/x/b.ts", content: "export {};\n" })).toMatchObject({ paths: ["/x/b.ts"], content: "export {};\n", canAllow: true });
    expect(
      shown("MultiEdit", {
        file_path: "/x/c.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      }),
    ).toMatchObject({ content: "b\n\nd", canAllow: true });
    expect(shown("NotebookEdit", { notebook_path: "/x/n.ipynb", new_source: "print(1)" })).toMatchObject({ paths: ["/x/n.ipynb"], content: "print(1)", canAllow: true });
  });

  test("an edit whose content can't be shown in full is paths only, and can only be denied", () => {
    const big = shown("Write", { file_path: "/x/big.ts", content: "a".repeat(4_001) });
    expect(big).toEqual({ tool: "Write", paths: ["/x/big.ts"], cwd: CWD, nonce: NONCE, expiresAt: LATER, canAllow: false });
    expect(shown("Write", { file_path: "/x/ok.ts", content: "x".repeat(4_000) })).toMatchObject({ canAllow: true });
    expect(shown("NotebookEdit", { notebook_path: "/x/n.ipynb", edit_mode: "delete", cell_id: "c1" })).toMatchObject({ canAllow: false });
    expect(shown("Write", { file_path: "/x/rtl.ts", content: "const s = '\u202e';" })).toMatchObject({ canAllow: false });
  });

  test("no prompt for an .env file", () => {
    expect(shown("Write", { file_path: "/x/.env", content: "PORT=3000" })).toBeNull();
    expect(shown("Edit", { file_path: "/x/.env.local", old_string: "a", new_string: "b" })).toBeNull();
  });

  test("WebFetch: the whole URL", () => {
    expect(shown("WebFetch", { url: "https://docs.example.com/guide/start?page=2#install", prompt: "summarize it" })).toEqual({
      tool: "WebFetch",
      url: "https://docs.example.com/guide/start?page=2#install",
      cwd: CWD,
      nonce: NONCE,
      expiresAt: LATER,
      canAllow: true,
    });
    expect(shown("WebFetch", { url: "https://api.example.com/v1?token=abc123" })).toBeNull();
    expect(shown("WebFetch", { url: "file:///etc/passwd" })).toBeNull();
  });

  test("MCP tools: argument names and values", () => {
    expect(shown("mcp__claude_ai_Claude_Docs__batch", { container: { kind: "project", id: "p1" }, batch: [] })).toEqual({
      tool: "mcp__claude_ai_Claude_Docs__batch",
      mcp: { server: "claude_ai_Claude_Docs", tool: "batch", args: ["container", "batch"], values: ['{"kind":"project","id":"p1"}', "[]"] },
      cwd: CWD,
      nonce: NONCE,
      expiresAt: LATER,
      canAllow: true,
    });
    expect(shown("mcp__my-server__run", { job: "nightly" }, { mcp_server: "my-server" })?.mcp).toEqual({ server: "my-server", tool: "run", args: ["job"], values: ['"nightly"'] });
    expect(shown("mcp__claude_ai_Claude_Docs__read", { id: "x" }, { mcp_server: "claude.ai Claude Docs" })?.mcp).toMatchObject({ server: "claude.ai Claude Docs", tool: "read" });
  });

  test("MCP values past the cap are left out, and the call can only be denied", () => {
    const big = shown("mcp__fs__write", { path: "/x", body: "a".repeat(2_000) });
    expect(big?.mcp).toEqual({ server: "fs", tool: "write", args: ["path", "body"] });
    expect(big?.canAllow).toBe(false);
  });

  test("every other tool stays in the terminal", () => {
    for (const tool of ["ExitPlanMode", "AskUserQuestion", "WebSearch", "Read", "Task", "TodoWrite"]) expect(shown(tool, { plan: "x", query: "y" })).toBeNull();
    expect(shown("Bash", { command: "ls" }, { mcp_server: "fs" })).toBeNull();
  });

  test("what it shows is well formed", () => {
    for (const s of [shown("Bash", { command: "ls" }), shown("Edit", { file_path: "/a", new_string: "b" }), shown("WebFetch", { url: "https://x.dev/" }), shown("mcp__a__b", { c: 1 })]) {
      expect(s).not.toBeNull();
      expect(wellFormedPermission(s)).toBe(true);
    }
  });
});

describe("what never leaves the machine", () => {
  test.each(SECRET)("flagged: %s", (_label, said) => {
    expect(looksSecret(said)).toBe(true);
    expect(shown("Bash", { command: said })).toBeNull();
  });

  test.each(NOT_SECRET)("not flagged: %s", (_label, said) => {
    expect(looksSecret(said)).toBe(false);
    expect(shown("Bash", { command: said })).not.toBeNull();
  });

  test("a secret in any shown field", () => {
    expect(shown("Bash", { command: "ls", description: `Bearer ${LETTERS.slice(0, 20)}` })).toBeNull();
    expect(shown("Edit", { file_path: `/tmp/${ghp}.txt`, new_string: "x" })).toBeNull();
    expect(shown("Write", { file_path: "/x/key.ts", content: `export const key = "${ghp}";` })).toBeNull();
    expect(shown("WebFetch", { url: `https://api.example.com/${ghp}` })).toBeNull();
    expect(shown("WebFetch", { url: "https://u:p@example.com/x" })).toBeNull();
    expect(shown("Bash", { command: "ls" }, { cwd: `/tmp/${ghp}` })).toBeNull();
    expect(shown("mcp__gh__call", { auth: ghp })).toBeNull();
  });

  test("the hex rule: a git SHA passes, longer hex doesn't unless it's labelled a digest", () => {
    expect(looksSecret(`git revert ${SHA40}`)).toBe(false);
    expect(looksSecret(`cast balance 0x${SHA40}`)).toBe(false);
    expect(looksSecret(`echo ${SHA40}0`)).toBe(true);
    expect(looksSecret(`echo ${HEX64}`)).toBe(true);
    expect(looksSecret(`git lfs pointer --oid sha256:${HEX64}`)).toBe(false);
    expect(looksSecret(`sha256sum -c <<< "${HEX64}  a.tgz"`)).toBe(false);
  });

  test("the base64 rule: random runs are flagged, words, paths and identifiers aren't", () => {
    expect(looksSecret(`echo ${RANDOM}`)).toBe(true);
    expect(looksSecret(`echo ${LETTERS}`)).toBe(false);
    expect(looksSecret("ls /Users/ana/Library/Application-Support/Kiwi/Profiles/Default2/Cache")).toBe(false);
    expect(looksSecret("bun run very-long-script-name-for-the-nightly-build-2026")).toBe(false);
  });

  test("over a cap", () => {
    expect(shown("Bash", { command: `echo ${"x".repeat(1_995)}` })).not.toBeNull();
    expect(shown("Bash", { command: `echo ${"x".repeat(1_996)}` })).toBeNull();
    expect(shown("Bash", { command: "ls", description: "d".repeat(501) })).toBeNull();
    expect(shown("Edit", { file_path: `/${"p".repeat(1_024)}`, new_string: "x" })).toBeNull();
    expect(shown("WebFetch", { url: `https://x.dev/${"a".repeat(2_048)}` })).toBeNull();
    expect(shown("mcp__a__b", Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])))).toBeNull();
  });

  test("anything that isn't the expected type", () => {
    expect(shown(42, { command: "ls" })).toBeNull();
    expect(shown("Bash", { command: "ls" }, { cwd: undefined })).toBeNull();
    expect(shown("Bash", { command: "ls" }, { cwd: 7 })).toBeNull();
    expect(shown("Bash", { command: 5 })).toBeNull();
    expect(shown("Bash", { command: "ls", description: 5 })).toBeNull();
    expect(shown("Bash", { command: "ls", dangerouslyDisableSandbox: "yes" })).toBeNull();
    expect(shown("Bash", null)).toBeNull();
    expect(shown("Bash", ["ls"])).toBeNull();
    expect(shown("Edit", { file_path: 5, new_string: "x" })).toBeNull();
    expect(shown("Edit", { file_path: "/a", new_string: 5 })).toBeNull();
    expect(shown("MultiEdit", { file_path: "/a", edits: "x" })).toBeNull();
    expect(shown("WebFetch", { url: 5 })).toBeNull();
    expect(shown("mcp__a__b", { c: 1 }, { mcp_server: 7 })).toBeNull();
    expect(shown("Bash", { command: "ls \u202e" })).toBeNull();
    expect(permissionShown({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: CWD }, "short", LATER)).toBeNull();
    expect(permissionShown({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: CWD }, NONCE, 9e15)).toBeNull();
  });
});

describe("a permission on the wire", () => {
  const good: PermissionShown = { tool: "Bash", command: "rm -rf dist", cwd: CWD, nonce: NONCE, expiresAt: LATER, canAllow: true };
  const ask = { v: 1, id: "x", from: "win", kind: "blocking", body: "Allow?", ts: 1, to: ["ana", "jon"], esc: true, choices: [...PERMISSION_CHOICES] };
  const reply = { v: 1, id: "y", from: "ana", kind: "msg", body: "A", ts: 2, re: [1] };

  test("an escalation with choices carries one; older payloads still pass", () => {
    expect(wellFormed({ ...ask, permission: good })).toBe(true);
    expect(wellFormed({ ...ask, permission: { ...good, call: "toolu_01ABC" } })).toBe(true);
    expect(wellFormed(ask)).toBe(true);
    expect(wellFormed(reply)).toBe(true);
  });

  test("refused: off an escalation, without choices, with an extra key, a bad nonce or time, past a cap", () => {
    expect(wellFormed({ ...ask, esc: undefined, choices: undefined, permission: good })).toBe(false);
    expect(wellFormed({ ...ask, choices: undefined, permission: good })).toBe(false);
    for (const bad of [
      { ...good, secret: "x" },
      { ...good, nonce: "short" },
      { ...good, nonce: "has space here" },
      { ...good, command: "x".repeat(2_001) },
      { ...good, expiresAt: 9e15 },
      { ...good, canAllow: "yes" },
      { ...good, sandbox: "off" },
      { ...good, command: undefined, paths: ["/a"] },
      { ...good, command: undefined, mcp: { server: "a", tool: "b", args: ["c"] } },
      { ...good, canAllow: false, mcp: { server: "a", tool: "b", args: ["c"], values: [] } },
      { ...good, canAllow: false, mcp: { server: "a", tool: "b", args: [], extra: 1 } },
      { ...good, call: "bad id!" },
    ])
      expect(wellFormed({ ...ask, permission: bad })).toBe(false);
    const { expiresAt, ...untimed } = good;
    expect(expiresAt).toBe(LATER);
    expect(wellFormedPermission(untimed)).toBe(false);
    expect(wellFormedPermission(null)).toBe(false);
    expect(wellFormedPermission([good])).toBe(false);
  });

  test("an answer names the ask it answers, on a reply only", () => {
    expect(wellFormed({ ...reply, perm: { ask: "x", allow: true } })).toBe(true);
    expect(wellFormed({ ...reply, re: undefined, perm: { ask: "x", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, re: [], perm: { ask: "x", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, kind: "event", ev: { op: "hello" }, perm: { ask: "x", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, perm: { ask: "x", allow: true, also: 1 } })).toBe(false);
    expect(wellFormed({ ...reply, perm: { ask: "x".repeat(101), allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, perm: { ask: "x", allow: "yes" } })).toBe(false);
  });

  test("settled, on a reply only", () => {
    for (const settled of ["terminal", "timeout", "ended"]) expect(wellFormed({ ...reply, settled })).toBe(true);
    expect(wellFormed({ ...reply, settled: "done" })).toBe(false);
    expect(wellFormed({ ...reply, re: undefined, settled: "ended" })).toBe(false);
    expect(wellFormed({ ...reply, kind: "event", ev: { op: "hello" }, settled: "ended" })).toBe(false);
  });
});

type Extra = Partial<Pick<Payload, "to" | "re" | "esc" | "choices" | "permission" | "perm" | "settled">>;

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: Extra = {}, signer = from): Promise<Message> {
  seq++;
  const p = await sign(ids[signer]!, { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

const view = (more: Partial<PermissionShown> = {}): PermissionShown => ({ tool: "Bash", command: "rm -rf dist", cwd: CWD, nonce: NONCE, expiresAt: LATER, canAllow: true, ...more });
const askFrom = (from: string, to: string[], permission: PermissionShown | null = view()) =>
  msg(from, "blocking", "Allow Bash: rm -rf dist?", { to, esc: true, choices: [...PERMISSION_CHOICES], ...(permission ? { permission } : {}) });
const answer = (from: string, ask: Message, allow: boolean, more: Extra = {}, signer = from) =>
  msg(from, "msg", allow ? PERMISSION_CHOICES[0] : PERMISSION_CHOICES[1], { re: [ask.seq], perm: { ask: ask.id, allow }, ...more }, signer);
const state = (ms: Message[], now?: number) =>
  fold(
    [...ms].sort((a, b) => a.seq - b.seq),
    roster,
    now,
  );
const decide = (ask: Message, reply: Message) => permissionAnswer(ask, reply, state([ask, reply]));

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "eve", "mac", "win"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-jon", name: "Jon" } },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human", sponsor: { user: "u-ana", name: "Ana" } },
    { name: "eve", pk: ids.eve!.pk, owner: false, at: 2, active: true, kind: "human", sponsor: { user: "u-eve", name: "Eve" } },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent", sponsor: { user: "u-jon", name: "Jon" } },
    { name: "win", pk: ids.win!.pk, owner: false, at: 4, active: true, kind: "agent", sponsor: { user: "u-ana", name: "Ana" } },
  ];
});

describe("who answers a permission", () => {
  test("the agent's own human allows or denies", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    expect(decide(ask, await answer("ana", ask, true))).toBe("allow");
    expect(decide(ask, await answer("ana", ask, false))).toBe("deny");
  });

  test("the owner only denies another person's agent, and allows their own", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    expect(decide(ask, await answer("jon", ask, true))).toBeNull();
    expect(decide(ask, await answer("jon", ask, false))).toBe("deny");
    const own = await askFrom("mac", ["jon"]);
    expect(decide(own, await answer("jon", own, true))).toBe("allow");
  });

  test("what can't be seen in full can only be denied", async () => {
    const ask = await askFrom("win", ["ana", "jon"], view({ sandbox: "off", canAllow: false }));
    expect(decide(ask, await answer("ana", ask, true))).toBeNull();
    expect(decide(ask, await answer("ana", ask, false))).toBe("deny");
  });

  test("nothing from anyone else, about anything else, or without the signed answer", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    const other = await askFrom("win", ["ana", "jon"]);
    seq++;
    const gap = seq;
    const later = await askFrom("win", ["ana", "jon"]);
    const early = { ...(await answer("ana", later, true)), seq: gap, rts: gap };
    expect(permissionAnswer(later, early, state([early, later]))).toBeNull();
    expect(decide(ask, await answer("mac", ask, true))).toBeNull();
    expect(decide(ask, await answer("eve", ask, true))).toBeNull();
    expect(decide(ask, await answer("win", ask, true))).toBeNull();
    expect(decide(ask, await answer("ana", ask, true, {}, "eve"))).toBeNull();
    expect(decide(ask, await answer("ana", ask, true, { re: [other.seq] }))).toBeNull();
    expect(decide(ask, await answer("ana", ask, true, { perm: { ask: other.id, allow: true } }))).toBeNull();
    for (const body of ["A", "A: Allow once", "B", "yes", "C"]) expect(decide(ask, await msg("ana", "msg", body, { re: [ask.seq] }))).toBeNull();
    const plain = await askFrom("win", ["ana", "jon"], null);
    expect(decide(plain, await answer("ana", plain, true))).toBeNull();
    const refused = await askFrom("win", ["eve"]);
    expect(decide(refused, await answer("eve", refused, true))).toBeNull();
    const expired = await askFrom("win", ["ana", "jon"], view({ expiresAt: 1 }));
    expect(decide(expired, await answer("ana", expired, false))).toBeNull();
  });
});

describe("when a permission stops waiting", () => {
  const open = (s: ReturnType<typeof state>, ask: Message) => s.openAsks.some((m) => m.seq === ask.seq);

  test("its asker settles it; anyone else's settled reply leaves it waiting", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    expect(open(state([ask]), ask)).toBe(true);
    const byOther = await msg("mac", "msg", "answered in the terminal", { re: [ask.seq], settled: "terminal" });
    expect(open(state([ask, byOther]), ask)).toBe(true);
    const bySelf = await msg("win", "msg", "answered in the terminal", { re: [ask.seq], settled: "terminal" });
    expect(open(state([ask, byOther, bySelf]), ask)).toBe(false);
    const plain = await askFrom("win", ["ana", "jon"], null);
    expect(open(state([plain, await msg("win", "msg", "ended", { re: [plain.seq], settled: "ended" })]), plain)).toBe(true);
  });

  test("it expires", async () => {
    const expiresAt = Date.now() + 60_000;
    const ask = await askFrom("win", ["ana", "jon"], view({ expiresAt }));
    expect(open(state([ask], expiresAt), ask)).toBe(true);
    expect(open(state([ask], expiresAt + 1), ask)).toBe(false);
  });

  test("a person's answer closes it as before", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    expect(open(state([ask, await answer("ana", ask, true)]), ask)).toBe(false);
  });
});

describe("through a relay", () => {
  test("a sent prompt, its answer and its close come back from history with their fields and the asker's id", async () => {
    const dataDir = mkdtempSync(joinPath(tmpdir(), "kiwi-permission-relay-"));
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    try {
      const relay = server.url.origin;
      const owner = await generateIdentity("human");
      const made = await Channel.create(relay, owner, { name: "human" });
      const ch = new Channel(made.access, relay, owner);
      const permission = view({ call: "toolu_01ABC" });
      const askSeq = await ch.send("Allow Bash: rm -rf dist?", { kind: "blocking", to: ["human"], esc: true, choices: [...PERMISSION_CHOICES], permission, id: "hook-ask-0001" });
      const perm = { ask: "hook-ask-0001", allow: true };
      const answerSeq = await ch.send(PERMISSION_CHOICES[0], { re: [askSeq], perm });
      const settleSeq = await ch.send("answered in the terminal", { re: [askSeq], settled: "terminal" });
      await expect(ch.send("x", { kind: "blocking", to: ["human"], esc: true, choices: [...PERMISSION_CHOICES], permission: { ...permission, nonce: "bad" } })).rejects.toThrow("malformed");
      await expect(ch.send("x", { id: "i".repeat(101) })).rejects.toThrow("at most 100");
      const { messages } = await ch.history(0);
      const bySeq = (n: number) => messages.find((m) => m.seq === n);
      expect(bySeq(askSeq)).toMatchObject({ id: "hook-ask-0001", esc: true, choices: [...PERMISSION_CHOICES], permission });
      expect(bySeq(answerSeq)).toMatchObject({ re: [askSeq], perm });
      expect(bySeq(answerSeq)?.id).not.toBe("hook-ask-0001");
      expect(bySeq(settleSeq)).toMatchObject({ re: [askSeq], settled: "terminal" });
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

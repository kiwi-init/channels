import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { looksSecret, PERMISSION_CHOICES, permissionAnswer, permissionChoices, permissionReply, permissionShown, wellFormedPermission, type PermissionShown } from "@kiwi/core/permission.ts";
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
  ["a _KEY assignment", "SERVICE_KEY=abc123def456 bun run sync"],
  ["an ENCRYPTION_KEY export", "export ENCRYPTION_KEY=hunter2hunter2"],
  ["an AUTH= assignment", "AUTH=ana:hunter2 ./sync.sh"],
  ["a CREDENTIALS= assignment", "CREDENTIALS=hunter2 make deploy"],
  ["an unquoted X-Goog-Api-Key header", "curl -H X-Goog-Api-Key:abc123 https://example.com/v1"],
  ["a key in a query string", "curl https://maps.example.com/api/geocode?key=abc123def"],
  ["an auth in a query string", "curl 'https://example.com/feed?user=ana&auth=abc123'"],
  ["a sig in a query string", "curl 'https://x.blob.core.windows.net/c/b?sv=2020-08-04&sig=abc123%3D'"],
  ["a presigned S3 URL", "curl 'https://b.s3.amazonaws.com/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123'"],
  ["a bare Basic credential", 'curl -H "Basic dXNlcjpwYXNz" https://example.com'],
  ["gh secret set --body", "gh secret set DEPLOY_TOKEN --body hunter2"],
  ["openssl -k", "openssl enc -aes-256-cbc -k hunter2 -in a.txt -out a.enc"],
  ["echo into sudo -S", "echo hunter2 | sudo -S rm -rf /opt/x"],
  ["writing prod.env", "cat > config/prod.env <<EOF"],
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
  ["a name ending in KEY", "MONKEY=1 KEYBOARD=us bun test"],
  ["Basic as a word", 'echo "Basic Instructions"'],
  ["a query string with a page", "curl 'https://example.com/list?page=2&sort=name'"],
  ["openssl without a key", "openssl rand -hex 16"],
  ["listing gh secrets", "gh secret list"],
  ["sudo -S without a pipe", "sudo -S true < /dev/null"],
  ["a file named environment", "cat environment.txt > out.txt"],
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

  test("edits: the paths, what is written and what it replaces", () => {
    const edit = shown("Edit", { file_path: "/Users/ana/code/kiwi/src/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" });
    expect(edit).toEqual({ tool: "Edit", paths: ["/Users/ana/code/kiwi/src/a.ts"], content: "const a = 2;", replaced: "const a = 1;", cwd: CWD, nonce: NONCE, expiresAt: LATER, canAllow: true });
    expect(shown("Write", { file_path: "/x/b.ts", content: "export {};\n" })).toMatchObject({ paths: ["/x/b.ts"], content: "export {};\n", canAllow: true });
    expect(
      shown("MultiEdit", {
        file_path: "/x/c.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      }),
    ).toMatchObject({ content: "b\n\nd", replaced: "a\n\nc", canAllow: true });
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
    expect(wellFormed({ ...reply, perm: { ask: "x", by: "win", of: "s", allow: true } })).toBe(true);
    expect(wellFormed({ ...reply, re: undefined, perm: { ask: "x", by: "win", of: "s", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, re: [], perm: { ask: "x", by: "win", of: "s", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, kind: "event", ev: { op: "hello" }, perm: { ask: "x", by: "win", of: "s", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, perm: { ask: "x", by: "win", of: "s", allow: true, also: 1 } })).toBe(false);
    expect(wellFormed({ ...reply, perm: { ask: "x".repeat(101), by: "win", of: "s", allow: true } })).toBe(false);
    expect(wellFormed({ ...reply, perm: { ask: "x", by: "win", of: "s", allow: "yes" } })).toBe(false);
  });

  test("settled, on a reply only", () => {
    for (const settled of ["terminal", "timeout", "ended"]) expect(wellFormed({ ...reply, settled })).toBe(true);
    expect(wellFormed({ ...reply, settled: "done" })).toBe(false);
    expect(wellFormed({ ...reply, re: undefined, settled: "ended" })).toBe(false);
    expect(wellFormed({ ...reply, kind: "event", ev: { op: "hello" }, settled: "ended" })).toBe(false);
  });
});

type Extra = Partial<Pick<Payload, "id" | "to" | "re" | "esc" | "choices" | "permission" | "perm" | "settled">>;

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
  msg(from, "msg", allow ? PERMISSION_CHOICES[0] : PERMISSION_CHOICES[1], { re: [ask.seq], perm: { ask: ask.id, by: ask.from, of: ask.sig!, allow }, ...more }, signer);
const state = (ms: Message[], now?: number) =>
  fold(
    [...ms].sort((a, b) => a.seq - b.seq),
    roster,
    now,
  );
const folded = (ms: Message[]) => ({ ...state(ms), bySeq: new Map(ms.map((m) => [m.seq, m])) });
const decide = (ask: Message, reply: Message) => permissionAnswer(ask, reply, folded([ask, reply]));

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
    expect(permissionAnswer(later, early, folded([early, later]))).toBeNull();
    expect(decide(ask, await answer("mac", ask, true))).toBeNull();
    expect(decide(ask, await answer("eve", ask, true))).toBeNull();
    expect(decide(ask, await answer("win", ask, true))).toBeNull();
    expect(decide(ask, await answer("ana", ask, true, {}, "eve"))).toBeNull();
    expect(decide(ask, await answer("ana", ask, true, { re: [other.seq] }))).toBeNull();
    expect(decide(ask, await answer("ana", ask, true, { perm: { ask: other.id, by: other.from, of: other.sig!, allow: true } }))).toBeNull();
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
      const history = (await ch.history(0)).messages;
      const sent = history.find((m) => m.seq === askSeq)!;
      expect(permissionReply(sent, true, fold(history, await ch.members()))).toBeNull();
      const perm = { ask: "hook-ask-0001", by: "human", of: sent.sig!, allow: true };
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

describe("review round 2 (T1454)", () => {
  test("an Allow names the exact ask it answers: a look-alike under the same id can't take it", async () => {
    const real = await askFrom("win", ["ana", "jon"], view({ command: "rm -rf ~" }));
    const lookalike = await msg("mac", "blocking", "Allow Bash: ls?", { id: real.id, to: ["ana", "jon"], esc: true, choices: [...PERMISSION_CHOICES], permission: view({ command: "ls" }) });
    const toLookalike = await answer("ana", real, true, { perm: { ask: real.id, by: lookalike.from, of: lookalike.sig!, allow: true } });
    expect(decide(real, toLookalike)).toBeNull();
    const wrongSig = await answer("ana", real, true, { perm: { ask: real.id, by: real.from, of: lookalike.sig!, allow: true } });
    expect(decide(real, wrongSig)).toBeNull();
    expect(decide(real, await answer("ana", real, true))).toBe("allow");
    expect(wellFormed({ ...toLookalike, perm: { ask: real.id, allow: true } })).toBe(false);
  });

  test("a macOS temp folder or a worktree with a UUID in its path isn't taken for a secret", () => {
    const tree = "/var/folders/2r/3954x2p578v2jdp4vkj8yytc0000gn/T/kiwi-permission-relay-Xq3Zr9";
    const other = "/private/tmp/claude-501/-Users-jow-www-channels/e56f7b60-e1ce-4045-9b46-521838197e78/scratchpad/kiwi-cache-backup";
    expect(permissionShown({ tool_name: "Bash", tool_input: { command: "bun test", description: "run the tests" }, cwd: tree }, NONCE, LATER)).not.toBeNull();
    expect(permissionShown({ tool_name: "Bash", tool_input: { command: `cd ${tree} && bun test test/permission.test.ts`, description: "run one file" }, cwd: tree }, NONCE, LATER)).not.toBeNull();
    expect(permissionShown({ tool_name: "Write", tool_input: { file_path: `${other}/notes.md`, content: "hello" }, cwd: tree }, NONCE, LATER)).not.toBeNull();
    expect(looksSecret(`cp ${tree}/a.txt ${other}/`)).toBe(false);
  });

  test("hook input that isn't an object reads as nothing to show, not a crash", () => {
    expect(permissionShown(null, NONCE, LATER)).toBeNull();
    expect(permissionShown("Bash", NONCE, LATER)).toBeNull();
  });

  test("an answer signed after the deadline doesn't count, whatever time the relay stamps on it", async () => {
    const ask = await askFrom("win", ["ana", "jon"], view({ expiresAt: seq + 1 }));
    seq += 5;
    const late = { ...(await answer("ana", ask, true)), rts: 0 };
    expect(decide(ask, late)).toBeNull();
  });

  test("a permission ask carries exactly the two choices the row and the hook agree on", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    expect(wellFormed(ask)).toBe(true);
    expect(wellFormed({ ...ask, choices: ["A: Yes", "B: No"] })).toBe(false);
  });
});

describe("permission follow-ups (T1588)", () => {
  const open = (s: ReturnType<typeof state>, ask: Message) => s.openAsks.some((m) => m.seq === ask.seq);

  test("only an answer that counts takes the row out of Needs you", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    const typed = await msg("ana", "msg", PERMISSION_CHOICES[0], { re: [ask.seq] });
    const ownerAllow = await answer("jon", ask, true);
    const outsider = await answer("eve", ask, false);
    expect(open(state([ask, typed, ownerAllow, outsider]), ask)).toBe(true);
    expect(open(state([ask, typed, await answer("ana", ask, true)]), ask)).toBe(false);
    expect(open(state([ask, await answer("jon", ask, false)]), ask)).toBe(false);
  });

  test("an ordinary escalation still closes on any reply from someone it was sent to", async () => {
    const plain = await askFrom("win", ["ana", "jon"], null);
    expect(open(state([plain, await msg("ana", "msg", "sure", { re: [plain.seq] })]), plain)).toBe(false);
  });

  test("an edit says when it replaces every match, and shows a deletion as what it removes", () => {
    expect(shown("Edit", { file_path: "/x/a.ts", old_string: "if (!ok) throw err;", new_string: "" })).toMatchObject({ content: "", replaced: "if (!ok) throw err;", canAllow: true });
    expect(shown("Edit", { file_path: "/x/a.ts", old_string: "foo", new_string: "bar", replace_all: true })).toMatchObject({ replaced: "foo", replaceAll: true, canAllow: true });
    expect(
      shown("MultiEdit", {
        file_path: "/x/a.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d", replace_all: true },
        ],
      }),
    ).toMatchObject({ replaceAll: true });
    expect(shown("Edit", { file_path: "/x/a.ts", old_string: "x", new_string: "y", replace_all: "yes" })).toBeNull();
  });

  test("an edit whose replaced text can't be shown in full can only be denied, and a prod.env is never shown", () => {
    const big = shown("Edit", { file_path: "/x/a.ts", old_string: "a".repeat(4_001), new_string: "b" });
    expect(big).toMatchObject({ paths: ["/x/a.ts"], content: "b", canAllow: false });
    expect(big).not.toHaveProperty("replaced");
    expect(shown("Write", { file_path: "/srv/app/config/prod.env", content: "A=1" })).toBeNull();
  });

  test("an edit that would be allowed must show what it replaces", () => {
    const edit = shown("Edit", { file_path: "/x/a.ts", old_string: "a", new_string: "b" })!;
    const unseen: PermissionShown = { ...edit };
    delete unseen.replaced;
    expect(wellFormedPermission(unseen)).toBe(false);
    expect(wellFormedPermission({ ...unseen, canAllow: false })).toBe(true);
    expect(wellFormedPermission({ ...edit, replaceAll: false })).toBe(false);
  });

  test("a secret in what an edit replaces keeps the prompt in the terminal", () => {
    expect(shown("Edit", { file_path: "/x/a.ts", old_string: 'const k = "' + ghp + '";', new_string: "const k = env();" })).toBeNull();
  });

  test("a base64 secret that starts with a slash is still a random run; a real path is judged by its folders", () => {
    const secret = join("/Zx8Q", LETTERS.slice(0, 26), "/HfJ1", LETTERS.slice(10, 36), "=");
    expect(looksSecret(`echo ${secret.slice(1)} | base64 -d`)).toBe(true);
    expect(looksSecret(`echo ${secret} | base64 -d`)).toBe(true);
    expect(looksSecret("cd /var/folders/2r/3954x2p578v2jdp4vkj8yytc0000gn/T/kiwi-permission-relay-Xq3Zr9 && ls")).toBe(false);
  });

  test("choices that aren't plain JSON are just not the permission choices", () => {
    expect(permissionChoices([...PERMISSION_CHOICES])).toBe(true);
    expect(permissionChoices([1n])).toBe(false);
    expect(permissionChoices([PERMISSION_CHOICES[0]])).toBe(false);
  });
});

describe("review follow-ups (T1594)", () => {
  test("no Allow is built on a relay-forged copy of a real ask, and the copy never reaches Needs you", async () => {
    const real = await askFrom("win", ["ana", "jon"], view({ command: "rm -rf ~" }));
    seq++;
    const copy: Message = { ...real, seq, rts: seq, permission: view({ command: "ls" }), sigOk: false };
    const s = state([real, copy]);
    expect(s.openAsks.map((m) => m.seq)).toEqual([real.seq]);
    expect(permissionReply(copy, true, s)).toBeNull();
    expect(permissionReply(real, true, s)).toEqual({ ask: real.id, by: "win", of: real.sig!, allow: true });
  });

  test("an answer counts only as the fold's own message at its seq, never a look-alike handed in for that seq", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    const plain = await msg("ana", "msg", "looks fine to me", { to: ["win"], re: [ask.seq] });
    const real = await answer("ana", ask, true);
    const s = folded([ask, plain, real]);
    const forged: Message = { ...plain, perm: permissionReply(ask, true, s)! };
    expect(permissionAnswer(ask, forged, s)).toBeNull();
    expect(permissionAnswer(ask, { ...real }, s)).toBeNull();
    expect(permissionAnswer(ask, real, s)).toBe("allow");
  });
});

describe("secret filter tuning (T1621)", () => {
  const flagged: [string, string][] = [
    ["a lowercase service_key", "service_key=abc123 ./sync.sh"],
    ["a lowercase api_auth", "api_auth=hunter2 make deploy"],
    ["an access_key query parameter", "curl 'https://s3.example.com/b?access_key=AB12cd34'"],
    ["an OAuth code query parameter", "curl 'https://example.com/callback?code=4/0AX4XfWhq'"],
    ["sudo -S after a flag with an argument", "echo hunter2 | sudo -u root -S rm -rf /opt/x"],
    ["a KEY with a literal value", "ENCRYPTION_KEY=hunter2hunter2 bun run seed"],
    ["a camelCase accessKey query parameter", "curl 'https://example.com/upload?accessKey=AB12cd34'"],
    ["a variable's written-out default", "API_KEY=${API_KEY:-hunter2} bun run sync"],
    ["a long random key under a plain name", `COSMOS_PRIMARY_KEY=${RANDOM}${RANDOM}== bun run sync`],
    ["a short key under a name that only ends in a plain one", "MYSORT_KEY=hunter2 ./sync.sh"],
    ["echo into sudo --stdin", "echo hunter2 | sudo --stdin rm -rf /opt/x"],
    ["echo into sudo -S after a long flag", "echo hunter2 | sudo --preserve-env -S rm -rf /opt/x"],
    ["a here-string into sudo -S", "sudo -S apt-get install -y jq <<< 'hunter2'"],
    ["a literal password after a $VAR user", 'curl -u "$CI_USER:hunter2" https://ci.example.com/api/json'],
    ["a PHP assignment", "$db_password = 'S3cr3tPassw0rd';"],
    ["a PowerShell assignment", '$Password = "P@ssw0rd!"'],
    ["a Perl assignment", "my $api_key = 'hunter2abc';"],
    ["Basic from an echo", 'curl -H "Authorization: Basic $(echo -n admin:hunter2 | base64)" https://ci.example.com/api'],
    ["a password from an echo", "export DB_PASSWORD=$(echo -n 'S3cretPw' | base64)"],
    ["kubectl --from-literal from an echo", "kubectl create secret generic db --from-literal=password=$(echo -n 'S3cretPw' | base64)"],
    ["docker login -p from an echo", 'docker login -u bot -p "$(echo hunter2)" registry.example.com'],
    ["a password from a here-doc command", "PASSWORD=$(cat <<EOF\nhunter2\nEOF\n) ./run.sh"],
    ["a JS template string", "const dbPassword = `S3cr3tPw!`;"],
    ["a Markdown code span", "password: `hunter2`"],
    ["a single-quoted $ password", "PGPASSWORD='$ecret' psql -h db"],
    ["a single-quoted $ mysql -p", "mysql -u root -p'$ecretPw1' shop"],
    ["a braced ref followed by literal text", 'PASSWORD="${PREFIX}hunter2" ./run.sh'],
    ["a ref followed by literal text", "PASSWORD=$USER-hunter2 ./run.sh"],
    ["a 32-character primary key", "AZURE_COGNITIVE_PRIMARY_KEY=0123456789abcdef0123456789abcdef ./x"],
    ["a 32-character routing key", "PAGERDUTY_ROUTING_KEY=e93facc04764012d7bfb002500d5d1a6 ./alert.sh"],
    ["a JSON password starting with $", '{"user": "ana", "password": "$ecretP4ss"}'],
    ["a YAML password starting with $", "db:\n  password: $ecretP4ss\n"],
    ["a key from a backtick command", "API_KEY=`op read op://dev/api/key` bun run sync"],
    ["a passphrase starting with a switch word", 'PASSPHRASE="on the road again" ./sign.sh'],
    ["a single-quoted passphrase starting with a switch word", "export GPG_PASSPHRASE='no one will guess this'"],
    ["a JSON passphrase starting with a switch word", '"passphrase": "no one will guess this"'],
    ["a YAML passphrase starting with a switch word", "passphrase: no one will guess this"],
    ["a JS passphrase starting with a switch word", 'const passphrase = "on the road again";'],
    ["a key starting with a switch digit", 'API_KEY="1 abc123def456"'],
    ["a ref, a colon and a literal", "BASIC_AUTH=$USER:hunter2 ./run.sh"],
    ["a quoted ref, a colon and a literal", 'PASSWORD="$USER:hunter2" ./run.sh'],
    ["a header with a ref, a colon and a literal", 'curl -H "X-Api-Key: $PREFIX:hunter2" https://x'],
    ["mysql -p with a ref, a colon and a literal", "mysql -p$USER:hunter2"],
    ["a JS template literal passphrase", "const passphrase = `correct horse battery staple`;"],
    ["a JS template literal Basic header", 'headers: { Authorization: `Basic ${btoa("admin:hunter2")}` }'],
    ["a JS template literal Token header", "fetch(url, { headers: { Authorization: `Token abc123def456` } })"],
    ["a password hashed by openssl passwd", "PASSWORD_HASH=$(openssl passwd -6 hunter2)"],
    ["a password hashed by htpasswd", "export TRAEFIK_AUTH=$(htpasswd -nb admin hunter2)"],
    ["a workflow expression with a fallback", "token: ${{ secrets.X || 'hunter2' }}"],
    ["a workflow expression followed by a literal", "PASSWORD=${{ secrets.X }}hunter2"],
    ["a test of $KEY", "[ $KEY = foo ] && echo same"],
    ["a test of $PASSWORD", "[ $DB_PASSWORD = changeme ] && exit 1"],
    ["a [[ test of $API_KEY", "[[ $API_KEY = foo ]] && echo same"],
    ["a test command on $KEY", "test $KEY = foo && echo same"],
    ["an SSH key path from the environment", "SSH_KEY=$HOME/.ssh/id_ed25519 ./deploy.sh"],
    ["a password from python3 -c", `PASSWORD_HASH=$(python3 -c 'import crypt; print(crypt.crypt("hunter2"))')`],
    ["a password from node -e", `ADMIN_PASSWORD_HASH=$(node -e 'console.log(require("bcryptjs").hashSync("hunter2", 10))')`],
    ["a password hashed by slappasswd", "PASSWORD_HASH=$(slappasswd -s hunter2)"],
    ["a token from a login with a literal password", "TOKEN=$(curl -s https://x/login --data pw=hunter2)"],
    ["a token from a script given a literal", "export TOKEN=$(./get-token.sh hunter2)"],
    ["a $ password in a quoted here-doc", "cat > settings.py <<'EOF'\nDB_PASSWORD = \"$ecretPw\"\nEOF"],
    ["a $ password echoed in single quotes", "echo 'DB_PASSWORD=$ecretPw' >> config.ini"],
    ["a $ password inside python3 -c", `python3 -c 'import psycopg2; psycopg2.connect(password="$ecretPw")'`],
    ["a ref, an @ and a literal", "PASSWORD=$USER@hunter2"],
    ["a ref, a slash and a literal", "PASSWORD=$PREFIX/hunter2"],
    ["a quoted ref followed by a literal", 'PASSWORD="$USER"hunter2'],
    ["a ref, a colon and a quoted literal", 'PASSWORD=$A:"hunter2"'],
    ["two refs and a literal", "PASSWORD=$A:$B:hunter2"],
    ["a ref and a literal inside quotes", 'ENCRYPTION_KEY="$A abc123"'],
    ["a test against a literal password", "[ $DB_PASSWORD = S3cr3tPw ]"],
    ["an if test against a literal password", "if [ $PASSWORD = hunter2 ]; then echo ok; fi"],
    ["a test command against a literal key", "test $API_KEY = abc123def456"],
    ["a test against a literal hex key", "[ $ENCRYPTION_KEY = 0123456789abcdef ]"],
    ["a key passed on from the environment", "ENCRYPTION_KEY=$ENCRYPTION_KEY bun run seed"],
    ["a token passed on from the environment", 'GITHUB_TOKEN="$GITHUB_TOKEN" gh pr list'],
    ["a key from a command", "API_KEY=$(op read op://dev/api/key) bun run sync"],
    ["a placeholder key in a query", "curl 'https://example.com/api?key=value'"],
    ["a key from a braced variable", "API_KEY=${API_KEY} bun run sync"],
    ["an Authorization header from the environment", 'curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user'],
    ["an Authorization header from a command", 'curl -H "Authorization: token $(gh auth token)" https://api.github.com/user'],
    ["an API-key header from the environment", 'curl -H "X-Api-Key: $API_KEY" https://api.example.com'],
    ["a token flag from the environment", 'vault login --token "$VAULT_TOKEN"'],
    ["a password flag from a command", "pg_dump --password=$(cat /run/secrets/db) shop"],
    ["URL credentials from the environment", "git clone https://x-access-token:$GH_TOKEN@github.com/ana/repo.git"],
    ["a URL user from the environment", "git clone https://${GH_TOKEN}@github.com/ana/repo.git"],
    ["curl -u with a password from the environment", 'curl -u "admin:$CI_PASSWORD" https://ci.example.com/api/json'],
    ["mysql -p from the environment", 'mysql -u root -p"$MYSQL_PWD" shop'],
    ["sshpass -p from the environment", 'sshpass -p "$SSH_PASS" ssh deploy@10.0.0.5'],
    ["docker login -p from the environment", "docker login -u bot -p $REGISTRY_TOKEN registry.example.com"],
    ["redis-cli -a from the environment", 'redis-cli -h cache -a "$REDIS_PASSWORD" ping'],
    ["kubectl --from-literal from the environment", 'kubectl create secret generic db --from-literal=password="$DB_PASSWORD"'],
    ["gh secret set from the environment", 'gh secret set DEPLOY_TOKEN --body "$DEPLOY_TOKEN"'],
    ["openssl -pass from the environment", 'openssl enc -aes-256-cbc -pass pass:"$PASSPHRASE" -in a.txt -out a.enc'],
    ["openssl -k from the environment", "openssl enc -aes-256-cbc -k $PASSPHRASE -in a.txt -out a.enc"],
    ["a key in a query from the environment", 'curl "https://maps.example.com/api/geocode?key=$MAPS_KEY"'],
    ["a here-string into sudo -S from the environment", 'sudo -S apt-get update <<< "$SUDO_PASS"'],
    ["a user and password from the environment", "AUTH=$USER:$PASS ./sync.sh"],
    ["a key from openssl rand", "SECRET_KEY=$(openssl rand -hex 32)"],
    ["a workflow's token from secrets", "cat > .github/workflows/ci.yml <<'EOF'\n      token: ${{ secrets.GITHUB_TOKEN }}\nEOF"],
    ["a reader or an echo", "DB_PASSWORD=$(op read op://dev/db/password || echo devpass123) bun run migrate"],
    ["a cat or an echo", "export TOKEN=$(cat ~/.token 2>/dev/null || echo dev-token-123)"],
    ["a cat then an echo", "PASSWORD=$(cat /run/secrets/pw; echo hunter2)"],
    ["a cat and an echo", "PASSWORD=$(cat pw && echo hunter2)"],
    ["a cat piped into sed", "PASSWORD=$(cat pw | sed s/x/hunter2/)"],
    ["a cat of a backtick echo", "PASSWORD=$(cat `echo hunter2`)"],
    ["a cat and an echo on two lines", "PASSWORD=$(cat pw\necho hunter2)"],
    ["a ref then a double-quoted literal", 'PASSWORD=$USER" hunter2" ./run.sh'],
    ["a ref then a single-quoted literal", "PASSWORD=$USER' hunter2' ./run.sh"],
    ["a header ref then a literal", 'curl -H "X-Api-Key: $USER"hunter2 https://x'],
    ["a docker -e ref and a literal", 'docker run -e "DB_PASSWORD=$USER hunter2" img'],
    ["curl -u with a ref and a literal", 'curl -u "admin:$USER hunter2" https://x'],
    ["an echoed ref, a semicolon and a literal", 'echo "DB_PASSWORD=$USER;hunter2" > config.ini'],
    ["a $ password in a backslash here-doc", 'cat > settings.py <<\\EOF\nDB_PASSWORD = "$ecretPw"\nEOF'],
    ["a ref and a literal before two @s", "git clone https://bot:$USER@hunter2@github.com/a/b.git"],
  ];
  const flaggedCommands: [string, string][] = [
    ["a switch word, a comma and a literal", "PASSWORD=yes,hunter2"],
    ["a docker -e password starting with 1;", 'docker run -e "MYSQL_ROOT_PASSWORD=1;Qx8#vLm2" mysql:8'],
    ["an echoed password starting with 0)", "echo 'password=0)Rt7!pLq2' >> /etc/app.conf"],
    ["a here-doc password starting with 1#", "cat > app.yml <<EOF\ndb:\n  password: 1#kX9vQ2mZ\nEOF"],
    ["an ssh password starting with 1)", 'ssh prod "DB_PASSWORD=1)Rt7pLq2 ./migrate"'],
    ["an sh -c token starting with 1;", "sh -c 'API_TOKEN=1;Zx8vQ2mLp4 ./sync'"],
  ];
  const flaggedText: [string, string][] = [
    ["a Python or TOML $ password", 'password = "$Summer2024"'],
    ["a Python call with a $ password", 'conn = psycopg2.connect(host="db", password="$ecretPw")'],
    ["a connection string with a $ password", "Server=db;User Id=sa;Password=$ecretPw;"],
    ["a JS URL with a $ password", 'const url = "postgres://app:$ecretPw@db/app";'],
    ["a properties $ password", "spring.datasource.password=$ecretP4ss"],
    ["a YAML braced ref, an @ and a literal", "password: ${A}@hunter2"],
    ["a JSON braced ref, a slash and a literal", '"password": "${A}/hunter2"'],
    ["an INI passphrase starting with a switch word", "passphrase = no one will guess this"],
    ["an INI password starting with a switch word", "[client]\npassword=on the road again"],
    ["a Python password after a None switch", 'password = None if DEBUG else "S3cr3tPw"'],
    ["a JSON token from a template", '{"token": "${API_TOKEN}"}'],
    ["a YAML ref, a comma and a literal", "password: ${A},hunter2"],
    ["a ref, a brace and a literal", "PASSWORD=${A}}hunter2"],
    ["a JSON ref, a bracket and a literal", '{"password": "${A}]hunter2"}'],
    ["a YAML ref, a hash and a literal", "password: ${A}#hunter2"],
    ["a YAML ref, a semicolon and a literal", "password: ${A};hunter2"],
    ["a YAML ref, a comma, a space and a literal", "password: ${A}, hunter2"],
    ["a ref, a parenthesis and a literal", "DB_PASSWORD=${PREFIX})hunter2"],
    ["a URL ref and a literal before two @s", 'url = "postgres://app:${A}@hunter2@db/app"'],
    ["a properties password starting with 1#", "spring.datasource.password=1#kX9vQ2mZ"],
    ["a YAML password starting with 0)", "production:\n  password: 0)Rt7!pLq2"],
    ["an INI password starting with 1;", "[client]\npassword=1;Hx72kq!"],
    ["a YAML password starting with 1]", "db:\n  password: 1]vN4@xQ8"],
    ["an INI password starting with 1,", "[db]\npassword = 1,Tz9#mQw2"],
    ["a compose password starting with 1}", "      MYSQL_ROOT_PASSWORD: 1}aP3!zR8"],
    ["a conf key starting with 0;", "api_key=0;f9Kq2Lm7Xa"],
    ["a YAML token starting with 1#", "token: 1#Zx8vQ2mLp4"],
    ["a YAML password starting with no#", "password: no#kX9vQ2"],
  ];
  const clean: [string, string][] = [
    ["a sort key", "SORT_KEY=name bun run export"],
    ["a primary key", "PRIMARY_KEY=id bun run migrate"],
    ["a partition key", "PARTITION_KEY=pk aws dynamodb scan"],
    ["a cache key", "CACHE_KEY=v2 bun run build"],
    ["a lowercase sort_key", "sort_key=name ./export.sh"],
    ["a status code in a query", "curl 'https://example.com/errors?code=E_BAD'"],
    ["sudo -S with ls -S later", "sudo -u root ls -S /opt"],
    ["a dynamo sort key", "DYNAMO_SORT_KEY=createdAt bun run export"],
    ["a public key", "STRIPE_PUBLIC_KEY=pk_test_abc123 bun run dev"],
    ["a routing key", "ROUTING_KEY=logs.info ./consume.sh"],
    ["a lowercase idempotency key", "idempotency_key=order-42 ./retry.sh"],
    ["an auth switch", "DISABLE_AUTH=true bun run dev"],
    ["a lowercase auth switch", "require_auth=false ./serve.sh"],
    ["a token switch", "SKIP_TOKEN_CHECK=1 bun test"],
    ["a long partition key name", "PARTITION_KEY=tenant_id_and_created_at bun run migrate"],
    ["a quoted switch", 'DISABLE_AUTH="true" bun run dev'],
  ];
  const cleanText: [string, string][] = [
    ["a Python auth switch", "requires_auth = True"],
    ["a Python default of None", "def lookup(items, group_key=None):"],
    ["a keyword switch", "client = Client(use_auth=False, retries=3)"],
    ["a YAML switch with a comment", "password: No  # disabled"],
    ["a JSON null", '{"password": null, "user": "ana"}'],
  ];
  for (const [name, said] of flagged) test(`flagged: ${name}`, () => expect([looksSecret(said, true), looksSecret(said)]).toEqual([true, true]));
  for (const [name, said] of flaggedCommands) test(`flagged as a command: ${name}`, () => expect(looksSecret(said, true)).toBe(true));
  for (const [name, said] of flaggedText) test(`flagged as content: ${name}`, () => expect(looksSecret(said)).toBe(true));
  for (const [name, said] of clean) test(`not flagged as a command: ${name}`, () => expect(looksSecret(said, true)).toBe(false));
  for (const [name, said] of cleanText) test(`not flagged as content: ${name}`, () => expect(looksSecret(said)).toBe(false));
  test("every input from the reviews stays in the terminal, as a Bash command or as a written file", () => {
    for (const [, said] of [...flagged, ...flaggedCommands]) expect(shown("Bash", { command: said })).toBeNull();
    for (const [, said] of flaggedText) expect(shown("Write", { file_path: "/x/settings.txt", content: said })).toBeNull();
  });
  test("a $VAR in a command stays in the terminal as on main, while a whole-value switch or a field-name key is sent", () => {
    expect(shown("Bash", { command: 'curl -H "Authorization: Bearer $TOKEN" https://api.example.com/user' })).toBeNull();
    expect(shown("Bash", { command: "DISABLE_AUTH=true bun run dev" })).not.toBeNull();
    expect(shown("Bash", { command: "SORT_KEY=name bun run export" })).not.toBeNull();
  });
});

describe("one message per seq (T1725)", () => {
  test("two messages at one seq are both refused, in either order, so no row or Allow is built on either", async () => {
    const real = await askFrom("win", ["ana", "jon"], view({ command: "rm -rf ~" }));
    const lookAlike: Message = { ...real, permission: view({ command: "ls" }), sigOk: false };
    for (const order of [
      [lookAlike, real],
      [real, lookAlike],
    ]) {
      const s = fold(order, roster);
      expect(s.trust.get(real.seq)).toBe("refused");
      expect(s.rejected.get(real.seq)).toBe(`two messages at #${real.seq}`);
      expect(s.openAsks).toEqual([]);
      for (const m of order) expect(permissionReply(m, true, s)).toBeNull();
    }
  });

  test("an answer doubled at its seq counts for nothing, whichever copy a caller holds, and the next message folds as usual", async () => {
    const ask = await askFrom("win", ["ana", "jon"]);
    const real = await answer("ana", ask, true);
    const plain = await msg("ana", "msg", "looks fine to me", { to: ["win"], re: [ask.seq] });
    const doubled: Message = { ...plain, seq: real.seq, rts: real.rts };
    const ms = [ask, real, doubled, plain];
    const s = fold(ms, roster);
    for (const m of [real, doubled]) expect(permissionAnswer(ask, m, { ...s, bySeq: new Map([[m.seq, m]]) })).toBeNull();
    expect(s.openAsks.map((m) => m.seq)).toEqual([ask.seq]);
    expect(s.trust.get(plain.seq)).toBe("verified");
  });
});

describe("secret filter follow-ups (T1923)", () => {
  const flagged: [string, string][] = [
    ["a YAML list item", "users:\n  - password: hunter2"],
    ["a YAML flow map", "db: {user: ana, password: hunter2}"],
    ["a flow map's first key", "{token: abc123def456}"],
    ["a typed field with a default", 'password: str = "hunter2"'],
    ["a short redis key", "REDIS_KEY=hunter2 ./cache.sh"],
    ["a short hash key", "HASH_KEY=mysecret ./sign.sh"],
    ["a long random S3 key", `S3_KEY=${RANDOM} ./upload.sh`],
  ];
  const clean: [string, string][] = [
    ["an S3 object path", 's3_key = "uploads/avatar.png"'],
    ["an object key from an f-string", 'object_key = f"users/{uid}/avatar.png"'],
    ["a TS type", "type Login = { user: string; password: string }"],
    ["a TS interface line", "  password: string;"],
    ["a Python signature", "def login(user: str, password: str) -> bool:"],
    ["a TS arrow signature", "const login = (user: string, password: string | null) => user"],
  ];
  for (const [name, said] of flagged) test(`flagged: ${name}`, () => expect([looksSecret(said, true), looksSecret(said)]).toEqual([true, true]));
  for (const [name, said] of clean) test(`not flagged as content: ${name}`, () => expect(looksSecret(said)).toBe(false));
});

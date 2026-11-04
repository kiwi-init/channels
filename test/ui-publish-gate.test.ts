import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
}

const flow = Bun.YAML.parse(await Bun.file(".github/workflows/ui-publish.yml").text()) as Workflow;
const GATE = resolve("scripts/ui-publish-gate.sh");

const root = mkdtempSync(join(tmpdir(), "kiwi-ui-publish-gate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const gitEnv = {
  PATH: process.env["PATH"] ?? "",
  HOME: root,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "kiwi",
  GIT_AUTHOR_EMAIL: "kiwi@example.com",
  GIT_COMMITTER_NAME: "kiwi",
  GIT_COMMITTER_EMAIL: "kiwi@example.com",
};

const dir = join(root, "repo");
mkdirSync(dir, { recursive: true });
const git = (...args: string[]): string => {
  const r = Bun.spawnSync(["git", ...args], { cwd: dir, env: gitEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};
const commit = (file: string, text: string): string => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
  git("add", "-A");
  git("commit", "-qm", `touch ${file}`);
  return git("rev-parse", "HEAD");
};

const bin = join(root, "bin");
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, "gh"), '#!/usr/bin/env bash\n[ -n "${FAKE_MANIFEST:-}" ] || exit 1\nprintf "%s" "$FAKE_MANIFEST"\n');
chmodSync(join(bin, "gh"), 0o755);

let runs = 0;
function gate(sha: string, live: string | null, event = "workflow_run"): { go: string; sha: string; said: string } {
  const out = join(root, `out-${++runs}`);
  writeFileSync(out, "");
  const r = Bun.spawnSync(["bash", GATE], {
    cwd: dir,
    env: {
      ...gitEnv,
      PATH: `${bin}:${gitEnv.PATH}`,
      SHA: sha,
      EVENT: event,
      GITHUB_OUTPUT: out,
      FAKE_MANIFEST: live === null ? "" : JSON.stringify({ uiVersion: `2026.11.6-${live.slice(0, 10)}`, seq: 1 }),
    },
  });
  if (r.exitCode !== 0) throw new Error(`gate exited ${r.exitCode}: ${r.stderr.toString()}`);
  const vars = Object.fromEntries(
    readFileSync(out, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split("=") as [string, string]),
  );
  return { go: vars["go"] ?? "", sha: vars["sha"] ?? "", said: r.stdout.toString() };
}

git("init", "-q", "-b", "main");
const first = commit("ui/src/app.tsx", "one");
const docsOnly = commit("README.md", "notes");
const uiChange = commit("ui/src/app.tsx", "two");
const coreChange = commit("packages/core/src/x.ts", "core");

describe("the UI channel ships only what main's full CI passed (T904)", () => {
  test("it runs after ci completes on main, never on a push of its own", () => {
    expect(Object.keys(flow.on).sort()).toEqual(["workflow_dispatch", "workflow_run"]);
    expect(flow.on["workflow_run"]).toEqual({ workflows: ["ci"], types: ["completed"], branches: ["main"] });
  });

  test("only a successful push run of this repo's main opens the gate", () => {
    const cond = flow.jobs["gate"]?.if ?? "";
    for (const part of [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_branch == 'main'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    ])
      expect(cond).toContain(part);
  });

  test("publish builds and stamps the commit CI passed, not the branch tip", () => {
    const publish = flow.jobs["publish"]!;
    expect(publish.needs).toBe("gate");
    expect(publish.if).toBe("needs.gate.outputs.go == 'true'");
    const steps = publish.steps ?? [];
    expect(steps.find((s) => s.uses?.startsWith("actions/checkout@"))?.with?.["ref"]).toBe("${{ needs.gate.outputs.sha }}");
    const stage = steps.find((s) => s.name === "Stage the UI");
    expect(stage?.env?.["SHA"]).toBe("${{ needs.gate.outputs.sha }}");
    expect(stage?.run).toContain('"$SHA"');
    expect(JSON.stringify(flow)).not.toContain("GITHUB_SHA");
  });

  test("a change outside the UI since the live one publishes nothing", () => {
    expect(gate(docsOnly, first)).toMatchObject({ go: "false", sha: docsOnly });
  });

  test("a UI or core change since the live one publishes the passed commit", () => {
    expect(gate(uiChange, first)).toMatchObject({ go: "true", sha: uiChange });
    expect(gate(coreChange, uiChange)).toMatchObject({ go: "true", sha: coreChange });
  });

  test("no live UI, or a live commit this clone doesn't have, publishes", () => {
    expect(gate(uiChange, null).go).toBe("true");
    expect(gate(uiChange, "0123456789abcdef").go).toBe("true");
  });

  test("a person's dispatch always publishes", () => {
    expect(gate(docsOnly, first, "workflow_dispatch")).toMatchObject({ go: "true", sha: docsOnly });
  });
});

import git from "isomorphic-git";
import { defineCommand, type Command, type ExecResult } from "just-bash/browser";
import { GITDIR, type Git, type Worktree } from "./tree.ts";

const dec = new TextDecoder();

function ok(stdout: string): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(msg: string, code = 1): ExecResult {
  return { stdout: "", stderr: `git: ${msg}\n`, exitCode: code };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function rel(p: string): string {
  return p.slice(1);
}

export function gitCommand(wt: Worktree, g: Git, author: { name: string; email: string }, mount: string): Command {
  return defineCommand("git", async (args, ctx) => {
    const [sub, ...rest] = args;
    if (sub === "status") {
      const ch = await wt.changes();
      const head = `On branch ${wt.branch} (${wt.base.commit.slice(0, 7)})\n`;
      if (ch.length === 0) return ok(`${head}nothing to commit, working tree clean\n`);
      const mark = { added: "A ", modified: " M", deleted: " D" } as const;
      return ok(head + ch.map((c) => `${mark[c.status]} ${rel(c.path)}`).join("\n") + "\n");
    }
    if (sub === "diff") {
      const only = rest.filter((a) => !a.startsWith("-")).map((a) => (a.startsWith("/") ? a.slice(mount.length) : `${ctx.cwd.slice(mount.length)}/${a}`.replace(/^\/+/, "/")));
      const ch = (await wt.changes()).filter((c) => only.length === 0 || only.includes(c.path));
      let out = "";
      for (const c of ch) {
        const before = c.before === null ? "" : dec.decode(await wt.baseBlob(c.before));
        const after = c.status === "deleted" ? "" : dec.decode(await wt.read(c.path));
        await ctx.fs.writeFile("/tmp/.git-a", before);
        await ctx.fs.writeFile("/tmp/.git-b", after);
        const r = ctx.exec === undefined ? undefined : await ctx.exec("diff -u /tmp/.git-a /tmp/.git-b", { cwd: "/" });
        const body = (r?.stdout ?? "").split("\n").slice(2).join("\n");
        out += `diff --git a/${rel(c.path)} b/${rel(c.path)}\n--- ${c.status === "added" ? "/dev/null" : `a/${rel(c.path)}`}\n+++ ${c.status === "deleted" ? "/dev/null" : `b/${rel(c.path)}`}\n${body}`;
      }
      return ok(out);
    }
    if (sub === "add") return ok("");
    if (sub === "commit") {
      const m = flag(rest, "-m");
      if (m === undefined) return fail("commit needs -m <message>");
      const oid = await wt.commit(m, author);
      if (oid === null) return fail("nothing to commit, working tree clean");
      return ok(`[${wt.branch} ${oid.slice(0, 7)}] ${m}\n`);
    }
    if (sub === "log") {
      const n = Number(flag(rest, "-n") ?? "10");
      const entries = await git.log({ fs: g.fs, gitdir: GITDIR, ref: wt.base.commit, depth: n, cache: g.cache });
      return ok(entries.map((e) => `${e.oid.slice(0, 7)} ${e.commit.author.name}: ${e.commit.message.split("\n")[0]}`).join("\n") + "\n");
    }
    if (sub === "branch") {
      const branches = await git.listBranches({ fs: g.fs, gitdir: GITDIR });
      return ok(branches.map((b) => `${b === wt.branch ? "*" : " "} ${b}`).join("\n") + "\n");
    }
    if (sub === "rev-parse") return ok(`${wt.base.commit}\n`);
    return fail(`'${sub ?? ""}' is not supported here (status, diff, add, commit -m, log [-n N], branch, rev-parse)`, 2);
  });
}

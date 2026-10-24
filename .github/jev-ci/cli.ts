#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
import { git, newerOnRemote } from "./git.ts";
import {
  dispatchedJobs,
  headline,
  LEGEND,
  mergeGroupRange,
  notesBlock,
  passedJobs,
  planTable,
  pullEvent,
  pullRequest,
  queueRuns,
  setOutput,
  summary,
  superseded,
  testedByQueue,
  trustedRef,
  upsertComment,
} from "./github.ts";
import { allHashes, onlyJobs, plan, pullRequestOnly, runAll, skipAll, type Decision, type Plan } from "./plan.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", default: ".github/jev-ci.yml" },
    repo: { type: "string", default: "." },
    base: { type: "string", default: "origin/main" },
    head: { type: "string", default: "HEAD" },
    github: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const config = await loadConfig(values.config);
const names: Record<string, string> = Object.fromEntries(Object.entries(config.jobs).map(([id, j]) => [id, j.name ?? id]));
const nameOf = (job: string) => names[job] ?? job;
const slug = process.env.GITHUB_REPOSITORY ?? "";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const note = (e: unknown) => console.error(`jev-ci: ${message(e)}`);

async function comment(body: string) {
  const pr = await pullRequest();
  if (pr && slug) await upsertComment(slug, pr, body).catch(note);
}

async function planInCI(): Promise<Plan> {
  const head = git(values.repo, ["rev-parse", "HEAD"]).trim();
  const event = process.env.GITHUB_EVENT_NAME;
  const payload = await pullEvent();
  if (event === "push") {
    const tested = testedByQueue(await queueRuns(slug, head).catch((e: unknown) => (note(e), [])), head, ".github/workflows/ci.yml");
    if (tested !== null) return skipAll(config, `the merge queue tested this commit as-is (run ${tested})`, allHashes(values.repo, head, config));
  }
  if (event === "merge_group") {
    const group = mergeGroupRange(payload);
    if (group.head !== head) throw new Error(`checked out ${head}, not the merge group's ${group.head}`);
    git(values.repo, ["fetch", "--no-tags", "--depth=1", "origin", group.base]);
    const passed = await passedJobs(slug, Object.keys(config.jobs), trustedRef(payload, process.env.GITHUB_REF)).catch((e: unknown) => (note(e), new Set<string>()));
    return plan({ repo: values.repo, base: group.base, head, config, configPath: values.config, passed });
  }
  const picked = event === "workflow_dispatch" ? dispatchedJobs(payload) : [];
  if (picked.length) return onlyJobs(config, picked, allHashes(values.repo, head, config));
  if (event !== "pull_request") return runAll(config, `${event} run: everything runs`, allHashes(values.repo, head, config), event);
  const trusted = trustedRef(payload, process.env.GITHUB_REF);
  const passed = await passedJobs(slug, Object.keys(config.jobs), trusted).catch((e: unknown) => (note(e), new Set<string>()));
  const base = git(values.repo, ["rev-parse", "HEAD^1"]).trim();
  return pullRequestOnly(config, await plan({ repo: values.repo, base, head, config, configPath: values.config, passed }));
}

function plannerFailed(e: unknown): Plan {
  note(e);
  const event = process.env.GITHUB_EVENT_NAME;
  const all = runAll(config, `planner failed, so everything runs: ${message(e)}`, {}, event);
  return event === "pull_request" ? pullRequestOnly(config, all) : all;
}

function newerPush(): string | null {
  const sha = process.env.GITHUB_SHA;
  const ref = process.env.GITHUB_REF;
  if (process.env.GITHUB_EVENT_NAME !== "push" || !sha || !ref) return null;
  try {
    return newerOnRemote(values.repo, ref, sha);
  } catch (e) {
    note(e);
    return null;
  }
}

type Planned = Pick<Plan, "decisions" | "jevCalls" | "inputTokens" | "changed" | "moved" | "notes">;

if (positionals[0] === "plan" && values.github) {
  const result = await planInCI().catch(plannerFailed);
  const compact = result.decisions.map(({ job, run, layer, reason, p, wouldSkip }) => ({ job, run, layer, reason, p, wouldSkip }));
  const planned: Planned = { decisions: compact, jevCalls: result.jevCalls, inputTokens: result.inputTokens, changed: result.changed, moved: result.moved, notes: result.notes };
  setOutput("run", JSON.stringify(Object.fromEntries(result.decisions.map((d) => [d.job, d.run]))));
  setOutput("hashes", JSON.stringify(result.hashes));
  setOutput("plan", JSON.stringify(planned));
  const body = `### jev-ci plan\n${headline(result)}\n${notesBlock(result.notes)}\n${planTable(result.decisions, names)}\n\n${LEGEND}\n`;
  summary(body);
  await comment(`${body}\n_Results appear here when **ci-ok** finishes._`);
  console.log(body);
} else if (positionals[0] === "report" && values.github) {
  const needs = JSON.parse(process.env.NEEDS ?? "{}") as Record<string, { result: string; outputs: Record<string, string> }>;
  const planned = needs.plan?.result === "success" && needs.plan.outputs.plan ? (JSON.parse(needs.plan.outputs.plan) as Planned) : undefined;
  if (!planned) {
    console.error(`jev-ci: the plan job ${needs.plan?.result ?? "is missing"}`);
    process.exit(1);
  }
  const results = Object.fromEntries(Object.entries(needs).map(([job, n]) => [job, n.result]));
  const bad = planned.decisions.filter((d: Decision) => (d.run ? results[d.job] !== "success" : results[d.job] !== "skipped"));
  const newer = bad.length ? newerPush() : null;
  const replaced =
    newer !== null &&
    superseded(
      bad.map((d) => d.job),
      results,
      newer,
    );
  const verdict =
    replaced && newer
      ? `⏭ Cancelled for ${newer.slice(0, 7)}, a newer push to ${process.env.GITHUB_REF_NAME ?? "this branch"}: its run gives the verdict.`
      : bad.length
        ? `❌ **${bad.map((d) => nameOf(d.job)).join(", ")}** did not pass.`
        : "✅ Every job that ran passed.";
  const body = `### jev-ci\n${headline(planned)} ${verdict}\n${notesBlock(planned.notes)}\n${planTable(planned.decisions, names, results)}\n\n${LEGEND}\n`;
  summary(body);
  await comment(body);
  console.log(body);
  process.exit(bad.length && !replaced ? 1 : 0);
} else if (positionals[0] === "plan") {
  const head = git(values.repo, ["rev-parse", values.head]).trim();
  const base = git(values.repo, ["merge-base", values.base, head]).trim();
  const result = await plan({ repo: values.repo, base, head, config, configPath: values.config });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`jev-ci plan  ${base.slice(0, 7)}..${head.slice(0, 7)}  ${headline(result)}`);
    for (const n of result.notes) console.log(`  note: ${n}`);
    for (const d of result.decisions) console.log(`  ${d.run ? "run " : "skip"}  ${nameOf(d.job).padEnd(20)} ${d.layer.padEnd(8)} ${d.reason}`);
  }
} else {
  console.error("usage: jev-ci plan [--github] | jev-ci report --github");
  process.exit(2);
}

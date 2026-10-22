import { createHash } from "node:crypto";
import { CONFIG_PATH, matches, parseConfig, type Config, type Job } from "./config.ts";
import { markMoves, readDiff, size, type FileChange } from "./diff.ts";
import { lsTree, show, type Tree } from "./git.ts";
import { importClosure } from "./imports.ts";
import { ask as askJev, MODEL, type Request, type Response } from "./jev.ts";
import { jobFingerprint, readWorkflow, workflowChange } from "./workflow.ts";

type Layer = "L0" | "L1" | "L2" | "fallback";
export type Decision = {
  job: string;
  run: boolean;
  layer: Layer;
  reason: string;
  p?: number;
  files?: { file: string; p: number }[];
  wouldSkip?: boolean;
};
export type Plan = {
  decisions: Decision[];
  hashes: Record<string, string>;
  changed: number;
  moved: number;
  notes: string[];
  jevLines: number;
  jevCalls: number;
  inputTokens: number;
};
export type Ask = (body: Request) => Promise<Response & { cached: boolean }>;

type Reader = (path: string) => boolean;

function readers(repo: string, revs: { rev: string; tree: Tree }[], config: Config): Record<string, Reader> {
  const out: Record<string, Reader> = {};
  for (const [id, j] of Object.entries(config.jobs)) {
    const imported = new Set<string>();
    if (j.imports_from?.length) for (const { rev, tree } of revs) for (const p of importClosure(repo, rev, tree, j.imports_from)) imported.add(p);
    out[id] = (path) => matches(j.inputs, path) || imported.has(path);
  }
  return out;
}

export function allHashes(repo: string, head: string, config: Config, tree: Tree = lsTree(repo, head), reads = readers(repo, [{ rev: head, tree }], config)): Record<string, string> {
  const wf = config.workflow ? readWorkflow(repo, head, config.workflow) : undefined;
  const out: Record<string, string> = {};
  for (const [job, j] of Object.entries(config.jobs)) {
    const files = [...tree].filter(([path]) => reads[job]!(path) || matches(j.always, path)).map(([path, sha]) => `${sha}\t${path}`);
    const definition = config.workflow ? [job, ...(j.parts ?? [])].map((id) => jobFingerprint(repo, head, tree, wf, id)).join("") : "";
    out[job] = createHash("sha256").update(files.join("\n")).update(definition).digest("hex").slice(0, 16);
  }
  return out;
}

function meaningful(f: FileChange, config: Config): boolean {
  const v = config.version_only;
  if (v && matches(v.files, f.path) && f.status === "modified" && f.hunks.length) {
    const re = new RegExp(v.pattern);
    if (f.hunks.every((h) => [...h.removed, ...h.added].every((l) => re.test(l)))) return false;
  }
  return f.binary || f.status !== "modified" || f.hunks.length > 0;
}

const touches = (read: Reader, f: FileChange) => read(f.path) || (!!f.from && read(f.from));

const clip = (lines: string[]) => lines.map((l) => (l.length > 300 ? l.slice(0, 300) + " …" : l));

const DEFAULT_CRITERIA = {
  true: "The change touches something this job checks, in a way that could make it fail.",
  false: "Nothing in the change can make this job fail: it only touches things this job does not check, or changes them in a way this job cannot detect.",
};

function jevRequest(f: FileChange, jobs: string[], config: Config): Request {
  const state: Record<string, unknown> = { file: f.path, change: f.status };
  if (f.from) state.renamed_from = f.from;
  if (matches(config.summarize_files, f.path)) state.change = "regenerated: a generated file, rebuilt from its source; content not shown";
  else if (f.status !== "deleted") {
    if (f.moved) state.moved = `${f.moved} changed lines are code moved verbatim between files (shown as ⟨…⟩); only the other lines are new`;
    state.hunks = f.hunks.map((h) => {
      const v = h.view ?? h;
      return { in: h.at || undefined, removed: clip(v.removed), added: clip(v.added) };
    });
  }
  const questions: Record<string, unknown> = {};
  for (const job of jobs) {
    const j = config.jobs[job]!;
    questions[job] = {
      type: "noul",
      instructions: {
        job: { name: j.name ?? job, what_it_checks: j.description },
        question: j.question ?? "Could this change to `file` make the CI job described in `job` fail?",
      },
      criteria: j.criteria ?? DEFAULT_CRITERIA,
    };
  }
  return { model: MODEL, state, questions };
}

const empty = (hashes: Record<string, string>): Plan => ({ decisions: [], hashes, changed: 0, moved: 0, notes: [], jevLines: 0, jevCalls: 0, inputTokens: 0 });

function runEvery(config: Config, reason: string, hashes: Record<string, string> = {}, event?: string): Plan {
  const decisions = Object.keys(config.jobs).map((job) =>
    event === "push" && config.jobs[job]!.push === false
      ? { job, run: false, layer: "L0" as const, reason: "a push to main skips it: pull requests and manual runs plan it" }
      : { job, run: true, layer: "L0" as const, reason },
  );
  return { ...empty(hashes), decisions };
}

export const runAll = (config: Config, reason: string, hashes: Record<string, string> = {}, event?: string): Plan => withParts(config, runEvery(config, reason, hashes, event));

function withParts(config: Config, p: Plan): Plan {
  const decisions = p.decisions.flatMap((d) => [
    d,
    ...(config.jobs[d.job]?.parts ?? []).map((part) => ({
      job: part,
      run: d.run,
      layer: d.layer,
      reason: `it does part of ${config.jobs[d.job]!.name ?? d.job}, so it goes with it`,
      ...(d.wouldSkip ? { wouldSkip: true } : {}),
    })),
  ]);
  return { ...p, decisions };
}

const ownerOf = (config: Config, id: string): string | undefined => Object.keys(config.jobs).find((job) => config.jobs[job]!.parts?.includes(id));

function configChange(repo: string, base: string, head: string, path: string): { all?: string; jobs: Map<string, string[]>; notes: string[] } {
  const out = { jobs: new Map<string, string[]>(), notes: [] as string[] };
  const a = show(repo, base, path);
  const b = show(repo, head, path);
  if (a === undefined || b === undefined) return { ...out, all: `${path} is new or gone` };
  let ca: Config, cb: Config;
  try {
    ca = parseConfig(a);
    cb = parseConfig(b);
  } catch {
    return { ...out, all: `${path} doesn't parse` };
  }
  const { jobs: ja = {}, ...ra } = ca;
  const { jobs: jb = {}, ...rb } = cb;
  const settings = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => JSON.stringify(ra[k as keyof typeof ra]) !== JSON.stringify(rb[k as keyof typeof rb]));
  if (settings.length) return { ...out, all: `${path}'s planner settings changed (${settings.join(", ")})` };
  const wording: string[] = [];
  for (const id of new Set([...Object.keys(ja), ...Object.keys(jb)])) {
    const x: Partial<Job> = ja[id] ?? {};
    const y: Partial<Job> = jb[id] ?? {};
    const fields = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => JSON.stringify(x[k as keyof Job]) !== JSON.stringify(y[k as keyof Job]));
    const rules = fields.filter((k) => k !== "description" && k !== "name");
    if (rules.length) out.jobs.set(id, rules);
    else if (fields.length) wording.push(jb[id]?.name ?? id);
  }
  if (wording.length) out.notes.push(`\`${path}\`: only the wording of ${wording.join(", ")} changed, which no job's result depends on; the plan already uses it.`);
  return out;
}

type PlanOptions = { repo: string; base: string; head: string; config: Config; configPath?: string; passed?: Set<string>; ask?: Ask };

export const plan = async (opts: PlanOptions): Promise<Plan> => withParts(opts.config, await decideJobs(opts));

async function decideJobs(opts: PlanOptions): Promise<Plan> {
  const { repo, base, head, config } = opts;
  const ask = opts.ask ?? askJev;
  const configPath = opts.configPath ?? CONFIG_PATH;
  const jobs = Object.keys(config.jobs);
  const headTree = lsTree(repo, head);
  const baseTree = lsTree(repo, base);
  const reads = readers(
    repo,
    [
      { rev: head, tree: headTree },
      { rev: base, tree: baseTree },
    ],
    config,
  );
  const hashes = allHashes(repo, head, config, headTree, reads);
  const diff = readDiff(repo, base, head);
  const changes = diff.filter((f) => meaningful(f, config));
  const bump = diff.find((f) => f.hunks.length > 0 && !meaningful(f, config));
  const out: Plan = { ...empty(hashes), changed: changes.length, moved: markMoves(changes) };
  const decide = (d: Decision) => out.decisions.push(d);
  const all = (reason: string): Plan => ({ ...runEvery(config, reason, hashes), changed: out.changed, moved: out.moved, notes: out.notes });

  const plannerChange = changes.find((f) => matches(config.run_all_when_changed, f.path));
  if (plannerChange) return all(`${plannerChange.path} changed: the planner itself changed`);

  const redefined = new Map<string, string>();
  if (config.workflow) {
    const wc = workflowChange(repo, config.workflow, { rev: base, tree: baseTree }, { rev: head, tree: headTree });
    if (wc.all) return all(wc.all);
    out.notes.push(...wc.notes);
    for (const [job] of wc.jobs) if (config.planner_jobs?.includes(job)) out.notes.push(`The \`${job}\` job changed; it runs on every pull request, so this run already checks it.`);
    for (const [job, why] of wc.jobs) if (config.jobs[job]) redefined.set(job, why);
    for (const [part, why] of wc.jobs) {
      const owner = ownerOf(config, part);
      if (owner && !redefined.has(owner)) redefined.set(owner, `${part}, which does part of it: ${why}`);
    }
    for (const id of Object.keys(readWorkflow(repo, head, config.workflow)?.jobs ?? {}))
      if (!config.jobs[id] && !config.planner_jobs?.includes(id) && !ownerOf(config, id)) decide({ job: id, run: true, layer: "L0", reason: `it has no entry in ${configPath}, so it always runs` });
  }
  if (changes.some((f) => f.path === configPath)) {
    const cc = configChange(repo, base, head, configPath);
    if (cc.all) return all(cc.all);
    out.notes.push(...cc.notes);
    for (const [job, fields] of cc.jobs) if (config.jobs[job] && !redefined.has(job)) redefined.set(job, `its ${fields.join(", ")} in ${configPath} changed`);
  }

  const open: string[] = [];
  for (const job of jobs) {
    const j = config.jobs[job]!;
    const forced = changes.find((f) => matches(j.always, f.path) || (!!f.from && matches(j.always, f.from)));
    if (redefined.has(job)) decide({ job, run: true, layer: "L0", reason: redefined.get(job)! });
    else if (forced) decide({ job, run: true, layer: "L0", reason: `${forced.path} changed, and it always runs this job` });
    else if (j.version_bumps && bump) decide({ job, run: true, layer: "L0", reason: `${bump.path} changed a version number` });
    else if (!changes.some((f) => touches(reads[job]!, f)))
      decide({ job, run: false, layer: "L0", reason: changes.length ? "none of its files changed" : "only version numbers or whitespace changed" });
    else open.push(job);
  }

  const toJudge: string[] = [];
  for (const job of open) {
    if (opts.passed?.has(`${job}:${hashes[job]}`)) decide({ job, run: false, layer: "L1", reason: "these exact inputs already passed" });
    else if (config.jobs[job]!.jev === false) decide({ job, run: true, layer: "L0", reason: "a file it checks changed, and any edit can fail it" });
    else toJudge.push(job);
  }
  if (!toJudge.length) return out;

  const work = changes.map((f) => ({ f, jobs: toJudge.filter((job) => touches(reads[job]!, f)) })).filter((w) => w.jobs.length);
  const sizeOf = (f: FileChange) => (matches(config.summarize_files, f.path) ? 1 : size(f));
  out.jevLines = work.reduce((n, w) => n + sizeOf(w.f), 0);
  if (out.jevLines > config.max_jev_lines) {
    for (const job of toJudge) decide({ job, run: true, layer: "fallback", reason: `too big to judge (${out.jevLines} new lines, over ${config.max_jev_lines})` });
    return out;
  }
  const forcedBy = new Map<string, string>();
  for (const w of work) if (w.f.binary || sizeOf(w.f) > config.max_file_lines) for (const job of w.jobs) forcedBy.set(job, w.f.path);

  const perJob = new Map<string, { file: string; p: number }[]>(toJudge.map((j) => [j, []]));
  let failed: string | undefined;
  const queue = work.map((w) => ({ ...w, jobs: w.jobs.filter((j) => !forcedBy.has(j)) })).filter((w) => w.jobs.length);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let w = queue.shift(); w; w = queue.shift()) {
        try {
          const res = await ask(jevRequest(w.f, w.jobs, config));
          out.jevCalls++;
          if (!res.cached) out.inputTokens += res.usage.input_tokens;
          for (const job of w.jobs) {
            const p = res.answers[job]?.noul;
            if (typeof p !== "number" || Number.isNaN(p)) throw new Error(`no answer for ${job}`);
            perJob.get(job)!.push({ file: w.f.path, p });
          }
        } catch (e) {
          failed = e instanceof Error ? e.message : String(e);
        }
      }
    }),
  );

  for (const job of toJudge) {
    const files = perJob.get(job)!.sort((a, b) => b.p - a.p);
    const p = 1 - files.reduce((q, f) => q * (1 - f.p), 1);
    const threshold = config.jobs[job]!.threshold ?? config.threshold;
    const top = files.slice(0, 2).map((f) => `${f.file} ${Math.round(f.p * 100)}%`);
    const odds = `${Math.round(p * 100)}% chance it fails${top.length ? ` (${top.join(", ")})` : ""}, threshold ${Math.round(threshold * 100)}%`;
    if (forcedBy.has(job)) decide({ job, run: true, layer: "fallback", reason: `${forcedBy.get(job)} is too big to judge`, p, files });
    else if (failed) decide({ job, run: true, layer: "fallback", reason: `Jev unavailable: ${failed}`, p, files });
    else if (p >= threshold) decide({ job, run: true, layer: "L2", reason: `Jev: ${odds}`, p, files });
    else if (config.mode === "shadow") decide({ job, run: true, layer: "L2", reason: `Jev would skip (${odds}); shadow mode runs it`, p, files, wouldSkip: true });
    else decide({ job, run: false, layer: "L2", reason: `Jev: ${odds}`, p, files });
  }
  return out;
}

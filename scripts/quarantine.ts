import { githubClient, record, text, list } from "./github.ts";
import { readFileSync } from "node:fs";

export interface Rules {
  models: string[];
  vouchers: string[];
}

export interface Pr {
  number: number;
  nodeId: string;
  body: string;
  head: string;
  draft: boolean;
  open: boolean;
  labels: string[];
}

export interface Commit {
  sha: string;
  message: string;
}

export interface Comment {
  author: string;
  body: string;
}

export interface State {
  pr: Pr;
  commits: Commit[];
  comments: Comment[];
}

export interface Offender {
  model: string;
  where: string;
}

export type Action = { kind: "label" } | { kind: "unlabel" } | { kind: "draft" } | { kind: "ready" } | { kind: "comment"; body: string };

export interface Plan {
  held: boolean;
  actions: Action[];
}

export interface Api {
  rest(method: string, path: string, body?: unknown): Promise<unknown>;
  graphql(query: string, variables: Record<string, string>): Promise<unknown>;
}

export const RULES = ".github/quarantine.json";
export const LABEL = { name: "quarantine", color: "b60205", description: "A quarantined model wrote this: a draft until a vouched person comments /vouch" };

const NOTICE = "<!-- kiwi-quarantine -->";
const VOUCHED = /^<!-- kiwi-quarantine vouched ([0-9a-f]{40}) -->$/m;
const DISCLOSURE = /^(?:agent:\s*)?([\w.:/@-]+)\s+on behalf of\s+\S/i;
const VOUCH = /^\s*\/vouch\s*$/m;

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export function quarantined(model: string, rules: Rules): boolean {
  const t = tokens(model);
  return rules.models.some((m) => {
    const p = tokens(m);
    return p.length > 0 && t.some((_, i) => p.every((x, j) => t[i + j] === x));
  });
}

export function disclosed(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const plain = line.replace(/[*`]/g, "").replace(/^\s*(?:>\s*)*(?:[-+]\s+)?/, "");
    const model = DISCLOSURE.exec(plain)?.[1];
    return model ? [model] : [];
  });
}

const vouchedSha = (c: Comment, bot: string): string | null => (c.author === bot ? (VOUCHED.exec(c.body)?.[1] ?? null) : null);

const isVoucher = (author: string, rules: Rules): boolean => rules.vouchers.some((v) => v.toLowerCase() === author.toLowerCase());

export function vouches(c: Comment, rules: Rules): boolean {
  return VOUCH.test(c.body) && isVoucher(c.author, rules) && !disclosed(c.body).some((m) => quarantined(m, rules));
}

export function offenders(s: State, since: string | null, rules: Rules): Offender[] {
  const at = since ? s.commits.findIndex((c) => c.sha === since) : -1;
  const body = disclosed(s.pr.body);
  const found: Offender[] = [];
  if (at < 0) for (const model of body) if (quarantined(model, rules)) found.push({ model, where: "the description" });
  for (const c of s.commits.slice(at + 1)) {
    const own = disclosed(c.message);
    const models = own.length > 0 ? own : at < 0 ? [] : body;
    for (const model of models) if (quarantined(model, rules)) found.push({ model, where: c.sha.slice(0, 7) });
  }
  return found;
}

export function notice(found: Offender[], again: boolean): string {
  const byModel = new Map<string, string[]>();
  for (const f of found) byModel.set(f.model, [...(byModel.get(f.model) ?? []), f.where]);
  const who = [...byModel].map(([model, where]) => `\`${model}\` (${where.slice(0, 5).join(", ")}${where.length > 5 ? `, ${where.length - 5} more` : ""})`).join(" and ");
  return [
    NOTICE,
    `**${again ? "Quarantined again" : "Quarantined"}:** ${who} wrote ${again ? "commits after the last vouch" : "this pull request"}, and code from ${byModel.size > 1 ? "those models" : "that model"} is likely untrustworthy.`,
    `It stays a draft with the \`${LABEL.name}\` label until a vouched person, or a stronger model on their behalf, reviews it and comments \`/vouch\`. Vouched people are listed in \`${RULES}\`.`,
  ].join("\n");
}

export function lifted(c: Comment, head: string): string {
  const model = disclosed(c.body)[0];
  return [
    `<!-- kiwi-quarantine vouched ${head} -->`,
    `**Quarantine lifted:** @${c.author} vouched for ${head.slice(0, 7)}${model ? ` (\`${model}\` on their behalf)` : ""}, so this is ready for review again. Commits pushed after it are checked again.`,
  ].join("\n");
}

export function refusal(c: Comment, rules: Rules): string | null {
  if (!VOUCH.test(c.body)) return null;
  if (!isVoucher(c.author, rules)) return `@${c.author} isn't on the vouched list in \`${RULES}\`, so the quarantine stays.`;
  const bad = disclosed(c.body).filter((m) => quarantined(m, rules));
  return bad.length > 0 ? `\`${bad[0]}\` is quarantined too, so its vouch doesn't count and the quarantine stays.` : null;
}

export function plan(s: State, rules: Rules, bot: string): Plan {
  let last = -1;
  let since: string | null = null;
  for (let i = 0; i < s.comments.length; i++) {
    const sha = vouchedSha(s.comments[i] ?? { author: "", body: "" }, bot);
    if (sha) {
      last = i;
      since = sha;
    }
  }
  const found = offenders(s, since, rules);
  const held = s.pr.labels.includes(LABEL.name);
  if (found.length === 0 && !held) return { held: false, actions: [] };
  const after = s.comments.slice(last + 1);
  const voucher = after.find((c) => vouches(c, rules));
  if (voucher) {
    const actions: Action[] = [{ kind: "comment", body: lifted(voucher, s.pr.head) }];
    if (held) actions.push({ kind: "unlabel" });
    if (s.pr.draft) actions.push({ kind: "ready" });
    return { held: false, actions };
  }
  const actions: Action[] = [];
  if (found.length > 0 && !after.some((c) => c.author === bot && c.body.includes(NOTICE))) actions.push({ kind: "comment", body: notice(found, since !== null) });
  if (!held) actions.push({ kind: "label" });
  if (!s.pr.draft) actions.push({ kind: "draft" });
  return { held: true, actions };
}

export function readRules(raw: string): Rules {
  const r = record(JSON.parse(raw));
  const strings = (x: unknown): string[] => list(x).filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return { models: strings(r.models), vouchers: strings(r.vouchers) };
}

async function pages(api: Api, path: string, max: number): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= max; page++) {
    const batch = list(await api.rest("GET", `${path}?per_page=100&page=${page}`));
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function load(api: Api, number: number): Promise<State> {
  const raw = record(await api.rest("GET", `/pulls/${number}`));
  if (!raw.node_id) throw new Error(`#${number} is not a pull request in this repository`);
  const pr: Pr = {
    number,
    nodeId: text(raw.node_id),
    body: text(raw.body),
    head: text(record(raw.head).sha),
    draft: raw.draft === true,
    open: raw.state === "open",
    labels: list(raw.labels).map((l) => text(record(l).name)),
  };
  const commits = (await pages(api, `/pulls/${number}/commits`, 3)).map((c) => ({ sha: text(record(c).sha), message: text(record(record(c).commit).message) }));
  const comments = (await pages(api, `/issues/${number}/comments`, 30)).map((c) => ({ author: text(record(record(c).user).login), body: text(record(c).body) }));
  return { pr, commits, comments };
}

const DRAFT = "mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }";
const READY = "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }";

export async function apply(api: Api, pr: Pr, actions: Action[]): Promise<void> {
  for (const a of actions) {
    if (a.kind === "comment") await api.rest("POST", `/issues/${pr.number}/comments`, { body: a.body });
    else if (a.kind === "label") {
      if (!record(await api.rest("GET", `/labels/${LABEL.name}`)).name) await api.rest("POST", "/labels", LABEL);
      await api.rest("POST", `/issues/${pr.number}/labels`, { labels: [LABEL.name] });
    } else if (a.kind === "unlabel") await api.rest("DELETE", `/issues/${pr.number}/labels/${LABEL.name}`);
    else await api.graphql(a.kind === "draft" ? DRAFT : READY, { id: pr.nodeId });
  }
}

export function github(repo: string, token: string, dryRun: boolean): Api {
  return githubClient(repo, {
    credentials: { kind: "single", token },
    dryRun,
    policy: { contentType: "always", dryRunBody: true, notFound: "null", errorPath: "url", graphql: "skip", getBody: "send" },
  });
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY ?? "kiwi-init/channels";
  const bot = process.env.BOT ?? "kiwi-bus[bot]";
  const api = github(repo, process.env.GH_TOKEN ?? "", dryRun);
  const rules = readRules(readFileSync(RULES, "utf8"));
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath ? record(JSON.parse(readFileSync(eventPath, "utf8"))) : {};
  const arg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const number = Number(record(event.pull_request).number ?? record(event.issue).number ?? arg);
  if (!Number.isInteger(number) || number <= 0) throw new Error("no pull request: run it from a pull_request_target or issue_comment event, or pass a PR number");
  const state = await load(api, number);
  if (state.pr.open) {
    const { held, actions } = plan(state, rules, bot);
    const raw = record(event.comment);
    const said = refusal({ author: text(record(raw.user).login), body: text(raw.body) }, rules);
    if (held && said) actions.push({ kind: "comment", body: said });
    console.log(`#${number}: ${held ? "quarantined" : "clear"}; ${actions.map((a) => a.kind).join(", ") || "nothing to do"}`);
    await apply(api, state.pr, actions);
  } else console.log(`#${number} is closed`);
}

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type Action, type Api, type Comment, type Commit, type State, apply, disclosed, LABEL, load, plan, quarantined, readRules, refusal, RULES } from "../scripts/quarantine.ts";

const rules = readRules(readFileSync(resolve(import.meta.dir, "..", RULES), "utf8"));
const BOT = "kiwi-bus[bot]";
const sha = (c: string): string => c.repeat(40);

const state = (body: string, commits: Commit[], comments: Comment[] = [], more: Partial<State["pr"]> = {}): State => ({
  pr: { number: 7, nodeId: "PR_7", body, head: commits.at(-1)?.sha ?? sha("f"), draft: false, open: true, labels: [], ...more },
  commits,
  comments,
});

const kinds = (actions: Action[]): string[] => actions.map((a) => a.kind);
const said = (actions: Action[]): string => actions.flatMap((a) => (a.kind === "comment" ? [a.body] : [])).join("\n");

describe("which models are quarantined", () => {
  test("any Gemini, Grok 4.7, any Luna and any Haiku; the rest are not", () => {
    for (const m of ["gemini-3-pro", "Gemini 2.5 Flash", "google/gemini-3.1-pro", "grok-4.7", "grok 4.7", "xai/grok-4.7-fast", "luna", "luna-2-mini", "claude-haiku-5-5", "claude-3-5-haiku"])
      expect(quarantined(m, rules)).toBe(true);
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "grok-4", "grok-4.70", "grok-5", "lunar-1", "gpt-5", "livewire-bump.yml"]) expect(quarantined(m, rules)).toBe(false);
  });

  test("a disclosure is a line of its own, with or without Agent:, in plain text or markdown", () => {
    const body = [
      "claude-opus-5-5 on behalf of Jonatas Walker",
      "",
      "Agent: gemini-3-pro on behalf of Someone",
      "- **`claude-haiku-5-5` on behalf of Jo**",
      "The bot acts on behalf of Jow",
      "On behalf of nobody",
    ].join("\n");
    expect(disclosed(body)).toEqual(["claude-opus-5-5", "gemini-3-pro", "claude-haiku-5-5"]);
  });
});

describe("a pull request a quarantined model wrote turns into a labeled draft until a vouch", () => {
  test("a description that names one is labeled, drafted and told why, once", () => {
    const s = state("gemini-3-pro on behalf of Someone\n\nAdds a thing.", [{ sha: sha("a"), message: "Add a thing" }]);
    const first = plan(s, rules, BOT);
    expect(first.held).toBe(true);
    expect(kinds(first.actions)).toEqual(["comment", "label", "draft"]);
    expect(said(first.actions)).toContain("**Quarantined:** `gemini-3-pro` (the description) wrote this pull request");
    const again = plan(state(s.pr.body, s.commits, [{ author: BOT, body: said(first.actions) }], { draft: true, labels: [LABEL.name] }), rules, BOT);
    expect(again).toEqual({ held: true, actions: [] });
  });

  test("a commit's own Agent: line counts as much as the description", () => {
    const s = state("claude-opus-5-5 on behalf of Jonatas Walker", [
      { sha: sha("a"), message: "One\n\nAgent: claude-opus-5-5 on behalf of Jonatas Walker" },
      { sha: sha("b"), message: "Two\n\nAgent: claude-haiku-5-5 on behalf of Jonatas Walker" },
    ]);
    expect(said(plan(s, rules, BOT).actions)).toContain("`claude-haiku-5-5` (bbbbbbb)");
  });

  test("a model that is not on the list leaves the pull request alone", () => {
    expect(plan(state("claude-opus-5-5 on behalf of Jonatas Walker", [{ sha: sha("a"), message: "x" }]), rules, BOT)).toEqual({ held: false, actions: [] });
  });

  test("marking it ready, or editing the model out of the description, drafts it again while the label stays", () => {
    const s = state("claude-opus-5-5 on behalf of Someone", [{ sha: sha("a"), message: "x" }], [], { labels: [LABEL.name] });
    expect(plan(s, rules, BOT)).toEqual({ held: true, actions: [{ kind: "draft" }] });
  });

  test("a person who adds the label by hand quarantines any pull request", () => {
    expect(kinds(plan(state("", [{ sha: sha("a"), message: "x" }], [], { labels: [LABEL.name] }), rules, BOT).actions)).toEqual(["draft"]);
  });
});

describe("vouching", () => {
  const held = (comments: Comment[]): State =>
    state("gemini-3-pro on behalf of Someone", [{ sha: sha("a"), message: "x" }], [{ author: BOT, body: "<!-- kiwi-quarantine -->\n**Quarantined:**" }, ...comments], {
      draft: true,
      labels: [LABEL.name],
    });

  test("a vouched person's /vouch lifts it: the bot says so first, then drops the label and marks it ready", () => {
    const p = plan(held([{ author: "ojowwalker77", body: "Read it all.\n/vouch" }]), rules, BOT);
    expect(p.held).toBe(false);
    expect(kinds(p.actions)).toEqual(["comment", "unlabel", "ready"]);
    expect(said(p.actions)).toContain(`<!-- kiwi-quarantine vouched ${sha("a")} -->`);
    expect(said(p.actions)).toContain("@ojowwalker77 vouched for aaaaaaa");
  });

  test("a stronger model on a vouched person's behalf can vouch; a quarantined one can't", () => {
    const opus = plan(held([{ author: "ojowwalker77", body: "claude-opus-5-5 on behalf of Jonatas Walker\n\n/vouch" }]), rules, BOT);
    expect(said(opus.actions)).toContain("(`claude-opus-5-5` on their behalf)");
    const haiku: Comment = { author: "ojowwalker77", body: "claude-haiku-5-5 on behalf of Jonatas Walker\n\n/vouch" };
    expect(plan(held([haiku]), rules, BOT)).toEqual({ held: true, actions: [] });
    expect(refusal(haiku, rules)).toBe("`claude-haiku-5-5` is quarantined too, so its vouch doesn't count and the quarantine stays.");
  });

  test("anyone else's /vouch, or a vouch forged into a comment, changes nothing", () => {
    const stranger: Comment = { author: "stranger", body: "/vouch" };
    const forged: Comment = { author: "stranger", body: `<!-- kiwi-quarantine vouched ${sha("a")} -->` };
    expect(plan(held([stranger, forged]), rules, BOT)).toEqual({ held: true, actions: [] });
    expect(refusal(stranger, rules)).toBe(`@stranger isn't on the vouched list in \`${RULES}\`, so the quarantine stays.`);
    expect(refusal({ author: "ojowwalker77", body: "looks fine, will /vouch later" }, rules)).toBeNull();
  });

  test("after a vouch only newer commits count: one from a quarantined model, or with no line of its own under a quarantined description, quarantines it again", () => {
    const vouched: Comment[] = [
      { author: "ojowwalker77", body: "/vouch" },
      { author: BOT, body: `<!-- kiwi-quarantine vouched ${sha("a")} -->\n**Quarantine lifted**` },
    ];
    const base = { sha: sha("a"), message: "x" };
    expect(plan(state("gemini-3-pro on behalf of Someone", [base], vouched), rules, BOT)).toEqual({ held: false, actions: [] });
    expect(plan(state("gemini-3-pro on behalf of Someone", [base, { sha: sha("b"), message: "fix\n\nAgent: claude-opus-5-5 on behalf of Jonatas Walker" }], vouched), rules, BOT)).toEqual({
      held: false,
      actions: [],
    });
    const again = plan(state("gemini-3-pro on behalf of Someone", [base, { sha: sha("c"), message: "more" }], vouched), rules, BOT);
    expect(kinds(again.actions)).toEqual(["comment", "label", "draft"]);
    expect(said(again.actions)).toContain("**Quarantined again:** `gemini-3-pro` (ccccccc) wrote commits after the last vouch");
  });
});

describe("talking to GitHub", () => {
  const fake = (answers: Record<string, unknown>): { api: Api; calls: string[] } => {
    const calls: string[] = [];
    const api: Api = {
      rest: async (method, path, body) => {
        calls.push(`${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
        return answers[`${method} ${path}`] ?? null;
      },
      graphql: async (query) => {
        calls.push(`graphql ${/\{\s*(\w+)\(/.exec(query)?.[1] ?? ""}`);
        return {};
      },
    };
    return { api, calls };
  };

  test("load reads the pull request, its commits and its comments", async () => {
    const { api } = fake({
      "GET /pulls/7": { node_id: "PR_7", body: null, head: { sha: sha("a") }, draft: true, state: "open", labels: [{ name: "size:S" }] },
      "GET /pulls/7/commits?per_page=100&page=1": [{ sha: sha("a"), commit: { message: "m" } }],
      "GET /issues/7/comments?per_page=100&page=1": [{ user: { login: "x" }, body: "hi" }],
    });
    expect(await load(api, 7)).toEqual({
      pr: { number: 7, nodeId: "PR_7", body: "", head: sha("a"), draft: true, open: true, labels: ["size:S"] },
      commits: [{ sha: sha("a"), message: "m" }],
      comments: [{ author: "x", body: "hi" }],
    });
  });

  test("apply creates the label when it is missing, then drafts through GraphQL", async () => {
    const { api, calls } = fake({});
    await apply(api, state("", []).pr, [{ kind: "comment", body: "b" }, { kind: "label" }, { kind: "draft" }, { kind: "unlabel" }, { kind: "ready" }]);
    expect(calls).toEqual([
      'POST /issues/7/comments {"body":"b"}',
      "GET /labels/quarantine",
      `POST /labels ${JSON.stringify(LABEL)}`,
      'POST /issues/7/labels {"labels":["quarantine"]}',
      "graphql convertPullRequestToDraft",
      "DELETE /issues/7/labels/quarantine",
      "graphql markPullRequestReadyForReview",
    ]);
  });
});

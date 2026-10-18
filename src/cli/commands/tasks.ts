import * as Effect from "effect/Effect";
import { oneLook, openSession } from "../../agent.ts";
import { Keystore } from "../../config.ts";
import { inlineText } from "@kiwi/core/membership.ts";
import { formatTask, formatTasks, looksLikeLine, taskStateWord } from "@kiwi/core/format.ts";
import type { TaskState } from "@kiwi/core/protocol.ts";
import { similarOpenTasks, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { bindingFor } from "../../hooks.ts";
import { args, opt } from "../args.ts";
import { type Command, die, keepDaemon, out, session } from "../context.ts";
import { firstLine, readText, taskArg, text } from "../input.ts";

const CLAIMS_GONE = "claims are gone: say what you're working on in the task, or post it";

export const taskCommands: Record<string, Command> = {
  task: () =>
    oneLook(
      Effect.gen(function* () {
        const s = yield* session();
        if (!args[1]) return yield* taskCommands.tasks!();
        const sub = args[1];
        const STATE_FOR: Record<string, TaskState> = { start: "doing", review: "review", done: "done" };
        if (sub === "add") {
          const title = yield* text(2);
          if (!title.trim()) return yield* die('usage: kiwi task add "title" [--owner NAME] [--review NAME|any] [--re N]');
          const re = opt.re === undefined ? undefined : Number(opt.re.replace(/^#/, "")) || (yield* die("--re takes a message number"));
          for (const gone of ["after", "needs"] as const)
            if (opt[gone] !== undefined) process.stderr.write(`kiwi: --${gone} is gone (tasks don't wait on or match anything now); put it in the title or --detail\n`);
          const { state: before } = yield* s.state();
          const id = yield* s.taskAdd(title, { owner: opt.owner, detail: opt.detail, ...(opt.review !== undefined ? { review: opt.review } : {}), ...(re !== undefined ? { re } : {}) });
          const like = similarOpenTasks(before, title).map((t) => t.id);
          const lines = [`added ${taskId(id)}`];
          if (like.length) lines.push(looksLikeLine(like));
          return out(lines.join("\n"));
        }
        if (sub === "list") return yield* taskCommands.tasks!();
        const id = yield* taskArg();
        if (sub === "show") {
          const { state } = yield* s.state();
          const shown = state.tasks.get(id) ?? (yield* die(`no task ${taskId(id)}`));
          return out(opt.json ? JSON.stringify(shown) : formatTask(state, shown));
        }
        if (sub === "match" || sub === "after") return yield* die(`kiwi task ${sub} is gone: tasks don't wait on or match anything now. Pick what you can do from the board (kiwi task)`);
        if (sub === "assign" || sub === "handoff") {
          const to = args[3] ?? (yield* die('usage: kiwi task assign T7 NAME ["where it stands, what\'s next"]'));
          const next = args.slice(4).join(" ") || opt.note || undefined;
          const state = yield* s.taskHandoff(id, to, next);
          const t = state.tasks.get(id)!;
          return out(`${taskId(id)} is ${t.owner}'s now${next ? "" : ' (add where it stands next time: kiwi task assign T7 NAME "…")'}`);
        }
        const verdictOf = { approve: "approved", reject: "rejected" } as const;
        const verdict = sub === "approve" || sub === "reject" ? verdictOf[sub] : undefined;
        const review = verdict && opt.file !== undefined ? yield* readText(opt.file) : undefined;
        if (review !== undefined && !review.trim()) return yield* die(`${opt.file} is empty`);
        const note = args.slice(3).join(" ") || opt.note || (review ? firstLine(review) : undefined) || undefined;
        const roundNo = opt.round === undefined ? undefined : /^[1-9]\d{0,8}$/.test(opt.round.trim()) ? Number(opt.round.trim()) : yield* die(`"${opt.round}" isn't a round number`);
        const judged = { ...(roundNo !== undefined ? { round: roundNo } : {}), ...(opt.at?.trim() ? { at: opt.at.trim() } : {}) };
        let state: ChannelState;
        if (sub === "claim") state = yield* s.taskClaim(id);
        else if (sub === "review")
          state = yield* s.taskUpdate(id, { state: "review", note, ...(opt.review !== undefined ? { review: opt.review } : {}), ...(opt.at?.trim() ? { at: opt.at.trim() } : {}) });
        else if (sub === "approve") state = yield* s.taskUpdate(id, { state: "done", verdict: "approved", note, ...judged }, review);
        else if (sub === "reject")
          state = yield* s.taskUpdate(
            id,
            { state: "doing", verdict: "rejected", note: note ?? (yield* die('usage: kiwi task reject T7 "what needs to change" (or --file review.md)')), ...judged },
            review,
          );
        else if (sub in STATE_FOR) state = yield* s.taskUpdate(id, { state: STATE_FOR[sub], note });
        else if (sub === "block") state = yield* s.taskUpdate(id, { note: `blocked${note ? `: ${note}` : ""}` });
        else if (sub === "cancel") state = yield* s.taskUpdate(id, { state: "cancelled", note });
        else if (sub === "drop") state = yield* s.taskUpdate(id, { owner: null, note });
        else if (sub === "note") state = yield* s.taskUpdate(id, { note: note ?? (yield* die('usage: kiwi task note T7 "…"')) });
        else if (sub === "proof") {
          const url = args[3] ?? (yield* die('usage: kiwi task proof T7 https://… [--label "preview"] [--note "…"]'));
          state = yield* s.taskUpdate(id, { proof: { url, ...(opt.label ? { label: opt.label } : {}) }, ...(opt.note ? { note: opt.note } : {}) });
        } else return yield* die(`unknown task command "${sub}"`);
        const t = state.tasks.get(id)!;
        out(`${taskId(id)} ${taskStateWord(t)}${t.owner ? ` @${t.owner}` : ""}: ${inlineText(t.title, 200)}`);
      }),
    ),

  tasks: () =>
    Effect.gen(function* () {
      if (opt.global) {
        const keys = yield* Keystore;
        const cfg = yield* keys.config;
        const aliases = Object.keys(cfg.channels).sort();
        if (!aliases.length) return yield* die("no channels yet (see: kiwi join)");
        const me = opt.as ?? process.env.KIWI_AS ?? bindingFor(process.cwd())?.as ?? (yield* die("--global needs to know who you are: pass --as NAME, or run it from your bound folder"));
        yield* keepDaemon;
        for (const alias of aliases) {
          const c = cfg.channels[alias]!;
          if (!(yield* keys.identitiesIn(c.roomId)).includes(me)) continue;
          const sess = yield* openSession(alias, c, me);
          const { state } = yield* sess.state();
          const owner = opt.mine ? sess.me : opt.owner;
          const lines = formatTasks(state, { all: opt.all, owner });
          out(`## ${alias}${lines === "no tasks" ? " — no tasks" : ""}`);
          if (lines !== "no tasks")
            out(
              lines
                .split("\n")
                .map((l) => `  ${l}`)
                .join("\n"),
            );
        }
        return;
      }
      const s = yield* session();
      const { state } = yield* s.state();
      out(formatTasks(state, { all: opt.all, owner: opt.mine ? s.me : opt.owner }));
    }),

  claim: () => Effect.sync(() => out(CLAIMS_GONE)),

  release: () => Effect.sync(() => out(CLAIMS_GONE)),

  claims: () => Effect.sync(() => out(CLAIMS_GONE)),
};

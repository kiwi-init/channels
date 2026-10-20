import * as Effect from "effect/Effect";
import { oneLook, openSession } from "../../agent.ts";
import { Keystore } from "../../config.ts";
import { inlineText } from "@kiwi/core/membership.ts";
import { formatTask, formatTasks, looksLikeLine, taskStateWord } from "@kiwi/core/format.ts";
import type { TaskState } from "@kiwi/core/protocol.ts";
import { leadCheckpointRefusal } from "@kiwi/core/reentry.ts";
import { isPerson, leadCheckpointKey, openRound, parseTaskId, similarOpenTasks, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { formatCandidates, pickFor, taskCandidates } from "@kiwi/core/routing.ts";
import { bindingFor } from "../../hooks.ts";
import { args, opt } from "../args.ts";
import { type Command, die, keepDaemon, offlineOk, out, session } from "../context.ts";
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
          const re = opt.re === undefined ? undefined : Number(opt.re.replace(/^#/, "")) || (yield* die("--re takes a message number"));
          const from = opt.from === undefined ? undefined : (parseTaskId(opt.from) ?? (yield* die("--from takes a task: --from T72")));
          if (opt.issue !== undefined) {
            const made = yield* s.taskFromIssue(opt.issue, {
              title: args.slice(2).join(" ") || undefined,
              owner: opt.owner,
              detail: opt.detail,
              ...(opt.review !== undefined ? { review: opt.review } : {}),
              ...(re !== undefined ? { re } : {}),
              ...(from !== undefined ? { from } : {}),
            });
            return out(`added ${taskId(made.id)} from ${made.issue}: ${made.title}\nclosing either one closes the other`);
          }
          const title = yield* text(2);
          if (!title.trim()) return yield* die('usage: kiwi task add "title" [--owner NAME] [--review NAME|any] [--re N] [--issue 12|owner/repo#12]');
          for (const gone of ["after", "needs"] as const)
            if (opt[gone] !== undefined) process.stderr.write(`kiwi: --${gone} is gone (tasks don't wait on or match anything now); put it in the title or --detail\n`);
          const { state: before } = yield* s.state();
          const id = yield* s.taskAdd(title, {
            owner: opt.owner,
            detail: opt.detail,
            ...(opt.review !== undefined ? { review: opt.review } : {}),
            ...(re !== undefined ? { re } : {}),
            ...(from !== undefined ? { from } : {}),
          });
          const like = similarOpenTasks(before, title).map((t) => t.id);
          const lines = [`added ${taskId(id)}`];
          if (like.length) lines.push(looksLikeLine(like));
          return out(lines.join("\n"));
        }
        if (sub === "list") return yield* taskCommands.tasks!();
        if (sub === "checkpoint" && args[2] === "lead") {
          const where = (opt.file !== undefined ? yield* readText(opt.file) : args.slice(3).join(" ") || opt.note || "").trim();
          if (!where) return yield* die("usage: kiwi task checkpoint lead --file note.md (where the channel stands: what you're waiting on, decisions in flight, next, traps)");
          const refused = leadCheckpointRefusal((yield* s.state()).state, s.me, where);
          if (refused) return yield* die(refused);
          yield* s.setFact(leadCheckpointKey(s.me), where);
          return out("lead checkpoint saved: a new session of yours starts from it");
        }
        const id = yield* taskArg();
        if (sub === "show") {
          const { state } = yield* s.state();
          const shown = state.tasks.get(id) ?? (yield* die(`no task ${taskId(id)}`));
          return out(opt.json ? JSON.stringify(shown) : formatTask(state, shown));
        }
        if (sub === "match" || sub === "after") return yield* die(`kiwi task ${sub} is gone: tasks don't wait on or match anything now. Pick what you can do from the board (kiwi task)`);
        if (sub === "who") {
          const { state } = yield* s.state();
          const t = state.tasks.get(id) ?? (yield* die(`no task ${taskId(id)}`));
          return out(formatCandidates(t, taskCandidates(state, id)));
        }
        if (sub === "assign" || sub === "handoff") {
          const { state: now } = yield* s.state();
          const top = args[3] ? null : pickFor(taskCandidates(now, id));
          const to = args[3] ?? top?.name ?? (yield* die(`nobody free has ${taskId(id)}'s context (kiwi task who ${taskId(id)}): name someone, kiwi task assign ${taskId(id)} NAME`));
          const next = args.slice(4).join(" ") || opt.note || undefined;
          const state = yield* s.taskHandoff(id, to, next);
          const t = state.tasks.get(id)!;
          const why = top ? `: ${top.reasons.join("; ")}` : "";
          return out(`${taskId(id)} is ${t.owner}'s now${why}${next ? "" : ' (add where it stands next time: kiwi task assign T7 NAME "…")'}`);
        }
        const verdictOf = { approve: "approved", reject: "rejected" } as const;
        const verdict = sub === "approve" || sub === "reject" ? verdictOf[sub] : undefined;
        const review = verdict && opt.file !== undefined ? yield* readText(opt.file) : undefined;
        if (review !== undefined && !review.trim()) return yield* die(`${opt.file} is empty`);
        const note = args.slice(3).join(" ") || opt.note || (review ? firstLine(review) : undefined) || undefined;
        const roundNo = opt.round === undefined ? undefined : /^[1-9]\d{0,8}$/.test(opt.round.trim()) ? Number(opt.round.trim()) : yield* die(`"${opt.round}" isn't a round number`);
        const judged = { ...(roundNo !== undefined ? { round: roundNo } : {}), ...(opt.at?.trim() ? { at: opt.at.trim() } : {}) };
        const before = sub === "review" ? (yield* s.state()).state : undefined;
        const reviewed = before?.tasks.get(id);
        const asker = before?.members.get(s.me);
        if (reviewed && !reviewed.review && opt.review === undefined && asker && !isPerson(asker))
          return yield* die(`${taskId(id)} has no reviewer: kiwi task review ${taskId(id)} --review NAME (or any)`);
        const kept = reviewed && opt.review !== undefined && !opt.at?.trim() && reviewed.owner !== s.me ? openRound(reviewed) : undefined;
        const keptAt = kept ? `round ${kept.n} stays open ${kept.at ? `at ${kept.at}` : "at no commit"}` : "";
        let state: ChannelState;
        if (sub === "claim") state = yield* s.taskClaim(id);
        else if (kept) state = yield* s.taskUpdate(id, { note: note ? `${keptAt}; ${note}` : keptAt, ...(opt.review !== undefined ? { review: opt.review } : {}) });
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
        else if (sub === "checkpoint") {
          const where = opt.file !== undefined ? yield* readText(opt.file) : args.slice(3).join(" ") || opt.note || "";
          if (!where.trim()) return yield* die("usage: kiwi task checkpoint T7 --file note.md (where the work stands: branch, last commit, done, next, traps)");
          state = yield* s.taskUpdate(id, { note: where.trim(), checkpoint: true });
        } else if (sub === "proof") {
          const url = args[3] ?? (yield* die('usage: kiwi task proof T7 https://… [--label "preview"] [--note "…"]'));
          state = yield* s.taskUpdate(id, { proof: { url, ...(opt.label ? { label: opt.label } : {}) }, ...(opt.note ? { note: opt.note } : {}) });
        } else return yield* die(`unknown task command "${sub}"`);
        const t = state.tasks.get(id)!;
        if (kept) return out(`${taskId(id)}'s review moved to ${t.review === "*" ? "anyone who hasn't worked on it" : t.review}: ${keptAt}`);
        out(`${taskId(id)} ${taskStateWord(t)}${t.owner ? ` @${t.owner}` : ""}: ${inlineText(t.title, 200)}`);
        if ((sub === "done" || sub === "review") && t.areas?.length) out(`folders it changed (for kiwi task who): ${t.areas.join(", ")}`);
        if (sub === "checkpoint") out(`checkpoint saved: a new session of yours starts ${taskId(id)} from it`);
      }),
    ),

  tasks: () =>
    offlineOk(
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
    ),

  claim: () => Effect.sync(() => out(CLAIMS_GONE)),

  release: () => Effect.sync(() => out(CLAIMS_GONE)),

  claims: () => Effect.sync(() => out(CLAIMS_GONE)),
};

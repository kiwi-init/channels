import * as Effect from "effect/Effect";
import { cleanGithubNote, MAX_GITHUB_ITEMS, type GithubNote } from "../protocol.ts";
import type { ChannelCore } from "./core.ts";
import type { Refused } from "./errors.ts";
import type { Relay } from "./relay.ts";

export interface GithubDiff {
  diff: string;
  base: string;
  truncated: boolean;
}

export interface ReviewCheck {
  repo: string;
  sha: string;
  verdict: "approved" | "rejected";
  task: number;
  note?: string;
}

export interface GithubFx {
  setGithubRepos(repos: string[]): Effect.Effect<string[], Refused, Relay>;
  drainGithub(): Effect.Effect<number, Refused, Relay>;
  githubDiff(repo: string, sha: string): Effect.Effect<GithubDiff, Refused, Relay>;
  postReviewCheck(c: ReviewCheck): Effect.Effect<{ url: string | null }, Refused, Relay>;
}

const PR_ACTIONS = new Set(["opened", "reopened", "closed", "ready_for_review", "synchronize", "edited", "converted_to_draft"]);

function worthSaying(i: GithubNote): boolean {
  if (i.event === "pull_request") return !i.action || PR_ACTIONS.has(i.action);
  if (i.event === "check_run" || i.event === "workflow_run") return i.action === "completed";
  return true;
}

export class ChannelGithub {
  constructor(private readonly ch: ChannelCore) {}

  readonly fx: GithubFx = {
    setGithubRepos: Effect.fn("Channel.setGithubRepos")({ self: this }, function* (this: ChannelGithub, repos: string[]) {
      yield* this.ch.ownerOnly();
      return (yield* this.ch.request<{ repos: string[] }>("/github/repos", { method: "PUT", body: JSON.stringify({ repos }) })).repos;
    }),

    githubDiff: Effect.fn("Channel.githubDiff")({ self: this }, function* (this: ChannelGithub, repo: string, sha: string) {
      return yield* this.ch.request<GithubDiff>("/github/diff", {}, { repo, sha });
    }),

    postReviewCheck: Effect.fn("Channel.postReviewCheck")({ self: this }, function* (this: ChannelGithub, c: ReviewCheck) {
      yield* this.ch.ownerOnly();
      return yield* this.ch.request<{ url: string | null }>("/github/check", { method: "POST", body: JSON.stringify(c) });
    }),

    drainGithub: Effect.fn("Channel.drainGithub")({ self: this }, function* (this: ChannelGithub) {
      yield* this.ch.ownerOnly();
      const { items } = yield* this.ch.request<{ items: ({ id: number } & Record<string, unknown>)[] }>("/github/queue");
      if (!items.length) return 0;
      const notes = items.flatMap((i) => {
        const note = cleanGithubNote(i);
        return note && worthSaying(note) ? [note] : [];
      });
      for (let at = 0; at < notes.length; at += MAX_GITHUB_ITEMS) {
        const batch = notes.slice(at, at + MAX_GITHUB_ITEMS);
        yield* this.ch.fx.send(`GitHub: ${batch.length} update${batch.length === 1 ? "" : "s"}`, { kind: "event", ev: { op: "github", items: batch } });
      }
      yield* this.ch.request("/github/ack", { method: "POST", body: JSON.stringify({ upTo: Math.max(...items.map((i) => i.id)) }) });
      return notes.length;
    }),
  };
}

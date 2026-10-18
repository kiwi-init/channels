import type { Message } from "./protocol.ts";
import { isPerson, type ChannelState } from "./state.ts";
import { taskOfBranch, visible } from "./work.ts";

export interface CiRed {
  seq: number;
  repo: string;
  sha: string;
  name: string;
  conclusion: string;
  branch?: string;
  url?: string;
  owner?: string;
  task?: number;
}

const CI_RED = new Set(["failure", "timed_out", "startup_failure"]);
const SHA_SHOWN = 12;

export const ciRedTitle = (name: string, branch?: string): string => `CI red: ${name}${branch ? ` on ${branch}` : ""}`;

export const ciCommitLine = (repo: string, sha: string): string => `Commit ${repo}@${sha.slice(0, SHA_SHOWN)}`;

export function ciPusher(state: ChannelState, branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  const active = (name: string | undefined) => (name && state.members.get(name)?.active ? name : undefined);
  const id = taskOfBranch(branch);
  const owner = active(id === null ? undefined : state.tasks.get(id)?.owner);
  if (owner) return owner;
  const on = [...state.members.values()].filter((m) => m.active && !isPerson(m) && m.card?.branch === branch);
  return on.length === 1 ? on[0]!.name : undefined;
}

function ciTaskFor(state: ChannelState, repo: string, sha: string): number | undefined {
  const line = ciCommitLine(repo, sha);
  for (const t of state.tasks.values()) if (t.state !== "done" && t.detail?.startsWith(line)) return t.id;
  return undefined;
}

export function ciRedAfter(state: ChannelState, messages: Message[], after: number): CiRed[] {
  const out: CiRed[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.seq <= after || m.ev?.op !== "github" || !visible(state, m) || state.rejected.has(m.seq)) continue;
    for (const i of m.ev.items) {
      if (i.event !== "check_run" || !i.conclusion || !CI_RED.has(i.conclusion) || !i.sha || !i.name) continue;
      const key = `${i.repo.toLowerCase()}@${i.sha}#${i.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const owner = ciPusher(state, i.branch);
      const task = ciTaskFor(state, i.repo, i.sha);
      out.push({
        seq: m.seq,
        repo: i.repo,
        sha: i.sha,
        name: i.name,
        conclusion: i.conclusion,
        ...(i.branch ? { branch: i.branch } : {}),
        ...(i.url ? { url: i.url } : {}),
        ...(owner ? { owner } : {}),
        ...(task ? { task } : {}),
      });
    }
  }
  return out;
}

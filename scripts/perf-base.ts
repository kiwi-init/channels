import type { FoldBase } from "@kiwi/core/state.ts";

export interface BaseSeed {
  agents: number;
  tasks: number;
  messages: number;
  taskNotes: number;
}

export interface BaseMeasure {
  n: number;
  window: number;
  bytes: number;
  mb: number;
  shares: Record<string, number>;
  counts: {
    tasks: number;
    taskNotes: number;
    reviewRounds: number;
    landingSteps: number;
    githubPrs: number;
    githubIssues: number;
    githubRuns: number;
    githubChecks: number;
    githubReleases: number;
    members: number;
    facts: number;
    threadOf: number;
    placeOf: number;
    roomOf: number;
  };
}

const utf8 = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
const pct = (part: number, whole: number): number => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export function measureBase(base: FoldBase, window: number): BaseMeasure {
  const bytes = utf8(base);
  const { tasks, github, threadOf, placeOf, roomOf } = base;
  const messageMaps = utf8(threadOf) + utf8(placeOf) + utf8(roomOf);
  const taskBytes = utf8(tasks);
  const githubBytes = utf8(github ?? null);
  return {
    n: base.n,
    window,
    bytes,
    mb: Math.round((bytes / 1048576) * 100) / 100,
    shares: {
      tasks: pct(taskBytes, bytes),
      github: pct(githubBytes, bytes),
      messageMaps: pct(messageMaps, bytes),
      rest: pct(bytes - taskBytes - githubBytes - messageMaps, bytes),
    },
    counts: {
      tasks: tasks.length,
      taskNotes: tasks.reduce((sum, t) => sum + t.notes.length, 0),
      reviewRounds: tasks.reduce((sum, t) => sum + t.rounds.length, 0),
      landingSteps: tasks.reduce((sum, t) => sum + (t.steps?.length ?? 0), 0),
      githubPrs: github?.prs.length ?? 0,
      githubIssues: github?.issues?.length ?? 0,
      githubRuns: github?.runs?.length ?? 0,
      githubChecks: github?.checks.reduce((sum, [, list]) => sum + list.length, 0) ?? 0,
      githubReleases: github?.releases?.length ?? 0,
      members: base.members.length,
      facts: base.facts.length,
      threadOf: threadOf.length,
      placeOf: placeOf.length,
      roomOf: roomOf.length,
    },
  };
}

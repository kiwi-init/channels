export const CHECK_PHASES = ["pre-ship", "post"] as const;
export type CheckPhase = (typeof CHECK_PHASES)[number];

export type CheckArtifact = { kind: "pr"; repo: string; pr: number; sha: string } | { kind: "run"; id: string } | { kind: "npm"; pkg: string; version: string };

export interface CheckAsk {
  phase: CheckPhase;
  decider: string;
  artifact: CheckArtifact;
  replaces?: number;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[\w.:/@+-]{1,200}$/;
const NPM_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const NAME = /^[\w.-]{1,50}$/;

const record = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

export function wellFormedArtifact(x: unknown): x is CheckArtifact {
  const a = record(x);
  if (!a) return false;
  switch (a.kind) {
    case "pr":
      return Object.keys(a).length === 4 && typeof a.repo === "string" && REPO.test(a.repo) && Number.isSafeInteger(a.pr) && (a.pr as number) > 0 && typeof a.sha === "string" && FULL_SHA.test(a.sha);
    case "run":
      return Object.keys(a).length === 2 && typeof a.id === "string" && RUN_ID.test(a.id);
    case "npm":
      return (
        Object.keys(a).length === 3 && typeof a.pkg === "string" && a.pkg.length <= 214 && NPM_NAME.test(a.pkg) && typeof a.version === "string" && a.version.length <= 100 && VERSION.test(a.version)
      );
    default:
      return false;
  }
}

export function wellFormedCheck(x: unknown): x is CheckAsk {
  const c = record(x);
  const replaces = c?.replaces === undefined || (Number.isSafeInteger(c.replaces) && (c.replaces as number) > 0);
  return (
    !!c &&
    Object.keys(c).length === (c.replaces === undefined ? 3 : 4) &&
    replaces &&
    (CHECK_PHASES as readonly unknown[]).includes(c.phase) &&
    typeof c.decider === "string" &&
    NAME.test(c.decider) &&
    wellFormedArtifact(c.artifact)
  );
}

export const ARTIFACT_USAGE = "--artifact pr:owner/repo#N@SHA (the full 40-character head), run:ID or npm:package@version";

export function parseArtifact(spec: string): CheckArtifact | string {
  const said = spec.trim();
  const colon = said.indexOf(":");
  const kind = colon > 0 ? said.slice(0, colon) : "";
  const rest = said.slice(colon + 1);
  const pr = /^([^#\s]+)#(\d+)@([0-9a-f]{40})$/.exec(rest);
  const at = rest.lastIndexOf("@");
  const artifact: CheckArtifact | null =
    kind === "pr" && pr
      ? { kind: "pr", repo: pr[1]!, pr: Number(pr[2]), sha: pr[3]! }
      : kind === "run"
        ? { kind: "run", id: rest }
        : kind === "npm" && at > 0
          ? { kind: "npm", pkg: rest.slice(0, at), version: rest.slice(at + 1) }
          : null;
  return artifact && wellFormedArtifact(artifact) ? artifact : `${ARTIFACT_USAGE}, not "${said}"`;
}

const letterOf = (choice: string) => /^([A-Z])\s*[:.)-]/.exec(choice)?.[1];

export function choiceIn(body: string, choices: readonly string[]): string | undefined {
  const said = body.trim();
  const exact = choices.find((c) => c.trim() === said);
  if (exact) return exact;
  const letter = /^([A-Z])(?:\s*[:.)-]|\s*$)/.exec(said)?.[1];
  return letter ? choices.find((c) => letterOf(c) === letter) : undefined;
}

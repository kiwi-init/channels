import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { daemonListening, daemonSock } from "../src/daemon.ts";
import { hooksFixture } from "./hooks-fixture.ts";

setDefaultTimeout(90_000);

type Env = Record<string, string>;

const fixture = hooksFixture({ prefix: "kiwi-persona", sessionId: "persona", channel: "persona", transport: { kind: "direct" }, pollMs: 100 });
const { agent, owner, ok, until, env: S, session } = fixture;
let me = "";

const prompt = (env: Env = S) => ok(agent, ["hook", "prompt"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent }));
const stop = async (env: Env = S): Promise<string> => {
  const out = await ok(agent, ["hook", "stop"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent, hook_event_name: "Stop" }));
  return out ? (JSON.parse(out) as { reason: string }).reason : "";
};
const role = (name: string, about?: string) => ok(owner, ["--as", "human", "role", me, name, ...(about === undefined ? [] : ["--about", about])], { CLAUDECODE: "" });
const CHANGED = "The owner changed your personality:";

async function toldBy(hook: () => Promise<string>, says: string): Promise<string> {
  let out = "";
  await until(async () => (out = await hook()).includes(says), `a hook that says ${JSON.stringify(says)}`);
  return out;
}

beforeAll(async () => {
  await fixture.start();
  me = fixture.me;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the daemon holding the seat");
});

afterAll(() => fixture.dispose());

test("an agent given a personality mid-session is told it at its next hook, once", async () => {
  expect(await prompt()).not.toContain(CHANGED);
  await role("Reviewer", "Use a sub agent for each review.");
  const told = await toldBy(prompt, CHANGED);
  expect(told).toContain(`${CHANGED}\nYou are now Reviewer (Builder).`);
  expect(told).toContain("Your instructions: Use a sub agent for each review.");
  expect(told.indexOf(CHANGED)).toBe(0);
  expect(await prompt()).not.toContain(CHANGED);
  expect(await stop()).not.toContain(CHANGED);
});

test("a change between turns stops the turn once to say it; taking it away is told too", async () => {
  await role("Reviewer", "Review alone, then post the verdict.");
  const reason = await toldBy(stop, CHANGED);
  expect(reason).toContain("Your instructions: Review alone, then post the verdict.");
  expect(await stop()).not.toContain(CHANGED);
  expect(await prompt()).not.toContain(CHANGED);
  await role("none");
  expect(await toldBy(prompt, "took your personality away")).toContain("The owner took your personality away: its role and instructions no longer apply.");
  expect(await prompt()).not.toContain("took your personality away");
});

test("a new session reads its personality in the brief, and its first hooks don't repeat it", async () => {
  await role("Reviewer", "Third rule.");
  await toldBy(prompt, "Third rule.");
  const next = session("persona-next");
  const start = await ok(agent, ["hook", "session-start"], next, JSON.stringify({ session_id: "persona-next", cwd: agent, source: "startup", hook_event_name: "SessionStart" }));
  const brief = (JSON.parse(start) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  expect(brief).toContain("You join as Reviewer (Builder).");
  expect(brief).toContain("Your instructions: Third rule.");
  expect(await prompt(next)).not.toContain(CHANGED);
  expect(await stop(next)).not.toContain(CHANGED);
});

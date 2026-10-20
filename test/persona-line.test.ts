import { expect, test } from "bun:test";
import type { Persona } from "@kiwi/core/personality.ts";
import { personaChange, personaMark } from "../src/hooks/persona-line.ts";

const reviewer: Persona = { name: "Reviewer", role: "reviewer", capabilities: ["write", "review"], areas: [], instructions: "Use a sub agent for each review." };

test("a personality is told when it changes, and only then", () => {
  const told = personaChange(personaMark(undefined), reviewer, "kiwi", 2_000);
  expect(told).toBe("The owner changed your personality:\nYou are now Reviewer. You may write and ask, review others' rounds.\nYour instructions: Use a sub agent for each review.");
  expect(personaChange(null, reviewer, "kiwi", 2_000)).toBe(told);
  expect(personaChange(personaMark(reviewer), reviewer, "kiwi", 2_000)).toBeNull();
  expect(personaChange(null, undefined, "kiwi", 2_000)).toBeNull();
  expect(personaChange(personaMark(undefined), undefined, "kiwi", 2_000)).toBeNull();
  expect(personaChange(personaMark(reviewer), { ...reviewer, instructions: "Review alone." }, "kiwi", 2_000)).toContain("Your instructions: Review alone.");
  expect(personaChange(personaMark(reviewer), undefined, "kiwi", 2_000)).toBe("The owner took your personality away: its role and instructions no longer apply.");
});

test("a personality too long for the hook is cut, with where to read all of it", () => {
  const long = { ...reviewer, instructions: "x".repeat(1_900) };
  const cut = personaChange(null, long, "kiwi", 300)!;
  expect(cut.length).toBeLessThanOrEqual(300);
  expect(cut.startsWith("The owner changed your personality:\nYou are now Reviewer.")).toBe(true);
  expect(cut.endsWith(" …\n(`kiwi prompt` has all of it)")).toBe(true);
  expect(personaChange(null, long, "kiwi", 20)).toBeNull();
});

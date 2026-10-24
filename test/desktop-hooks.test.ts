import { expect, test } from "bun:test";
import type { HookRow } from "@kiwi/core/harnesses.ts";
import { withClaude } from "../desktop/src/ipc/terminals.ts";

const claude = (state: HookRow["state"]): HookRow => ({ harness: "claude", state, text: state });

test("Settings' Claude Code hooks row reads the installed Claude Code, which the app's kiwi can't see from its environment (T13)", () => {
  expect(withClaude(claude("partial"), "wakes")).toEqual(claude("partial"));
  expect(withClaude(claude("partial"), "old").state).toBe("installed");
  expect(withClaude(claude("partial"), null)).toEqual(claude("partial"));
  expect(withClaude(claude("missing"), "none").state).toBe("absent");
  expect(withClaude(claude("missing"), "old").state).toBe("missing");
  expect(withClaude(claude("missing"), null).state).toBe("missing");
  expect(withClaude({ harness: "codex", state: "missing", text: "not installed" }, "none").state).toBe("missing");
});

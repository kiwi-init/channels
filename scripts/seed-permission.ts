#!/usr/bin/env bun
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { PERMISSION_CHOICES, permissionShown } from "@kiwi/core/permission.ts";
import { humanOf, ownerOf } from "@kiwi/core/state.ts";
import { AgentLive } from "../src/agent.ts";
import { args } from "../src/cli/args.ts";
import { out, session } from "../src/cli/context.ts";

const [tool = "", given = "{}", cwd = process.cwd()] = args;
const shown = permissionShown({ tool_name: tool, tool_input: JSON.parse(given), cwd }, crypto.randomUUID().replaceAll("-", ""), Date.now() + 30 * 60_000);
if (!shown) {
  process.stderr.write(`seed-permission: core shows nothing for ${tool} ${given}\n`);
  process.exit(2);
}

const runtime = ManagedRuntime.make(AgentLive);
const exit = await runtime.runPromiseExit(
  Effect.gen(function* () {
    const s = yield* session();
    const { state } = yield* s.state();
    const to = [...new Set([humanOf(state, s.me), ownerOf(state)].filter((n): n is string => !!n))];
    const seq = yield* s.send(`Permission to use ${tool}`, { to, kind: "blocking", esc: true, choices: [...PERMISSION_CHOICES], permission: shown });
    out(`asked #${seq}`);
  }),
);
process.exit(Exit.isSuccess(exit) ? 0 : 1);

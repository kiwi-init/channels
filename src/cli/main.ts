#!/usr/bin/env bun
// kiwi: the Kiwi Init command line (Channels).
//
// Every command is an Effect, run by one ManagedRuntime on the relay over HTTP
// and this computer's files (AgentLive). A command that can't go on fails with
// Quit (its line and exit code) or with whatever refused it; `fail` at the
// bottom turns that into the line on stderr and the exit code, in one place.
// A command's value, when it has one, is its exit code.

import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { AgentLive } from "../agent.ts";
import { VERSION } from "../version.ts";
import { refreshListeners } from "../hooks.ts";
import { forgetSecretCopies } from "../config/wipe.ts";
import { HELP } from "./help.ts";
import { args, ignoredOptions, opt, unexpectedOptions } from "./args.ts";
import { type Command, die, out } from "./context.ts";
import { joinCommands } from "./commands/join.ts";
import { adminCommands } from "./commands/admin.ts";
import { hookCommands } from "./commands/hooks.ts";
import { setupCommands } from "./commands/setup.ts";
import { channelCommands } from "./commands/channel.ts";
import { messageCommands } from "./commands/messages.ts";
import { profileCommands } from "./commands/profile.ts";
import { listenCommands } from "./commands/listen.ts";
import { compactCommands } from "./commands/compact.ts";
import { factCommands } from "./commands/facts.ts";
import { leaseCommands } from "./commands/leases.ts";
import { taskCommands } from "./commands/tasks.ts";
import { specCommands } from "./commands/specs.ts";
import { toolCommands } from "./commands/tools.ts";
import { contextLineCommands } from "./commands/context-line.ts";
import { seatCommands } from "./commands/seat.ts";
import { rexCommands } from "./commands/rex.ts";
import { terminalCommands } from "./commands/terminal.ts";
import { launchCommands } from "./commands/launch.ts";
import { loopCommands } from "./commands/loop.ts";
import { fail } from "./fail.ts";

// Early signals for `kiwi daemon` only (the first positional, same as the CLI). Bun plus the
// Effect runtime take ~100ms before runDaemonForeground arms a clean shutdown. A supervisor
// killing in that window would otherwise die with 143. runDaemonForeground disarms these
// once its own handler is in. Other commands keep the default so SIGINT still interrupts
// their Effect stream.
if (args[0] === "daemon") {
  let earlySigExit = false;
  const earlySig = (): void => {
    if (!earlySigExit) {
      earlySigExit = true;
      process.exit(0);
    }
  };
  process.once("SIGTERM", earlySig);
  process.once("SIGINT", earlySig);
  (globalThis as { __kiwiDisarmEarlySignals?: () => void }).__kiwiDisarmEarlySignals = () => {
    process.removeListener("SIGTERM", earlySig);
    process.removeListener("SIGINT", earlySig);
  };
}

const commands: Record<string, Command> = {
  ...adminCommands,
  ...joinCommands,
  ...hookCommands,
  ...setupCommands,
  ...channelCommands,
  ...messageCommands,
  ...profileCommands,
  ...listenCommands,
  ...compactCommands,
  ...factCommands,
  ...leaseCommands,
  ...taskCommands,
  ...specCommands,
  ...toolCommands,
  ...contextLineCommands,
  ...seatCommands,
  ...rexCommands,
  ...terminalCommands,
  ...launchCommands,
  ...loopCommands,
};

if (import.meta.main) {
  const cmd = opt.version ? "version" : args[0];
  if (cmd === "version") {
    out(VERSION);
    process.exit(0);
  }
  if (!cmd || opt.help || cmd === "help") {
    out(HELP);
    process.exit(0);
  }
  if (cmd === "upgrade" || cmd === "update") {
    try {
      if (args.length !== 1) throw new Error("usage: kiwi upgrade (or kiwi update)");
      const extra = unexpectedOptions([]);
      if (extra.length) throw new Error(`kiwi ${cmd} does not accept ${extra.map((name) => `--${name}`).join(", ")}`);
      const { upgrade } = await import("./upgrade.ts");
      await upgrade({ executable: process.execPath, source: /\.(ts|js)$/.test(Bun.main), version: VERSION, platform: process.platform, arch: process.arch, report: out });
      process.exit(0);
    } catch (error) {
      process.stderr.write(`kiwi: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }
  const shortcuts: Record<string, string> = { s: "status", t: "tasks" };
  const command = commands[shortcuts[cmd] ?? cmd];
  if (command && cmd !== "relay") forgetSecretCopies();
  if (command && cmd !== "daemon" && cmd !== "relay" && cmd !== "hook") await refreshListeners();
  // One runtime for the whole command: the relay over HTTP, and this computer's files.
  const runtime = ManagedRuntime.make(AgentLive);
  const exit = await runtime.runPromiseExit(command ? command() : die(`unknown command "${cmd}" (see: kiwi help)`));
  if (Exit.isFailure(exit)) await runtime.runPromise(fail(exit.cause));
  else if (cmd !== "mcp" && cmd !== "relay") {
    const ignored = cmd === "daemon" || cmd === "hook" ? [] : ignoredOptions();
    if (ignored.length) process.stderr.write(`kiwi: ${cmd} doesn't use ${ignored.map((o) => `--${o}`).join(", ")}, so ${ignored.length > 1 ? "they were" : "it was"} ignored\n`);
    process.exit(exit.value ?? 0);
  }
}

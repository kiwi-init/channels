import type { Command } from "./context.ts";

type Load = () => Promise<Record<string, Command>>;

const TABLE: [Load, string[]][] = [
  [() => import("./commands/admin.ts").then((m) => m.adminCommands), ["create", "quick", "requests", "check", "approve", "deny", "kick", "close", "role", "scope", "mode", "room", "tui", "web"]],
  [() => import("./commands/join.ts").then((m) => m.joinCommands), ["join"]],
  [() => import("./commands/hooks.ts").then((m) => m.hookCommands), ["hook", "hooks"]],
  [() => import("./commands/setup.ts").then((m) => m.setupCommands), ["setup", "login", "unpair", "cleanup", "daemon"]],
  [() => import("./commands/channel.ts").then((m) => m.channelCommands), ["rooms", "leave", "channels", "use", "wake", "status", "hold", "icon"]],
  [() => import("./commands/messages.ts").then((m) => m.messageCommands), ["send", "reply", "answering", "react", "edit", "delete", "show", "log", "query", "ask-human"]],
  [() => import("./commands/profile.ts").then((m) => m.profileCommands), ["color", "card", "hello", "prompt"]],
  [() => import("./commands/listen.ts").then((m) => m.listenCommands), ["listen"]],
  [() => import("./commands/compact.ts").then((m) => m.compactCommands), ["compact"]],
  [() => import("./commands/facts.ts").then((m) => m.factCommands), ["note"]],
  [() => import("./commands/leases.ts").then((m) => m.leaseCommands), ["lock", "unlock"]],
  [() => import("./commands/tasks.ts").then((m) => m.taskCommands), ["task", "goal", "claim", "release", "claims"]],
  [() => import("./commands/specs.ts").then((m) => m.specCommands), ["specs", "spec"]],
  [() => import("./commands/tools.ts").then((m) => m.toolCommands), ["relay", "demo", "doctor"]],
  [() => import("./commands/context-line.ts").then((m) => m.contextLineCommands), ["context-line"]],
  [() => import("./commands/seat.ts").then((m) => m.seatCommands), ["seat"]],
  [() => import("./commands/harnesses.ts").then((m) => m.harnessCommands), ["harnesses"]],
  [() => import("./commands/loop.ts").then((m) => m.loopCommands), ["loop"]],
];

export const RENAMED: Readonly<Record<string, string>> = {
  tail: "listen",
  wait: "listen --once",
  read: "listen --now",
  watch: "listen --webhook URL",
  ask: "send --ask",
  escalate: "ask-human",
  thread: "show N",
  save: "show N [dir]",
  members: "status --all",
  who: "status",
  charter: "status",
  facts: "note",
  set: "note KEY VALUE",
  get: "note KEY",
  unset: "note KEY --clear",
  tasks: "task",
  s: "status",
  t: "task",
};

export const COMMANDS: ReadonlyMap<string, Load> = new Map(TABLE.flatMap(([load, names]) => names.map((name): [string, Load] => [name, load])));

export const COMMAND_MODULES: readonly Load[] = TABLE.map(([load]) => load);

export async function commandFor(name: string): Promise<Command | undefined> {
  const load = COMMANDS.get(name);
  return load ? (await load())[name] : undefined;
}

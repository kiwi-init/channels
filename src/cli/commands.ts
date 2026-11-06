import type { Command } from "./context.ts";

type Load = () => Promise<Record<string, Command>>;

const TABLE: [Load, string[]][] = [
  [() => import("./commands/admin.ts").then((m) => m.adminCommands), ["create", "quick", "requests", "check", "approve", "deny", "kick", "close", "role", "scope", "mode", "room", "tui", "web"]],
  [() => import("./commands/join.ts").then((m) => m.joinCommands), ["join"]],
  [() => import("./commands/hooks.ts").then((m) => m.hookCommands), ["hook", "hooks"]],
  [() => import("./commands/setup.ts").then((m) => m.setupCommands), ["setup", "login", "unpair", "cleanup", "daemon"]],
  [() => import("./commands/channel.ts").then((m) => m.channelCommands), ["members", "rooms", "leave", "channels", "use", "wake", "status", "who", "charter", "hold", "icon"]],
  [
    () => import("./commands/messages.ts").then((m) => m.messageCommands),
    ["send", "ask", "reply", "answering", "react", "edit", "delete", "save", "show", "log", "thread", "query", "ask-human", "escalate"],
  ],
  [() => import("./commands/profile.ts").then((m) => m.profileCommands), ["color", "card", "hello", "prompt"]],
  [() => import("./commands/listen.ts").then((m) => m.listenCommands), ["listen", "read", "tail", "wait", "watch"]],
  [() => import("./commands/compact.ts").then((m) => m.compactCommands), ["compact"]],
  [() => import("./commands/facts.ts").then((m) => m.factCommands), ["note", "set", "get", "unset", "facts"]],
  [() => import("./commands/leases.ts").then((m) => m.leaseCommands), ["lock", "unlock"]],
  [() => import("./commands/tasks.ts").then((m) => m.taskCommands), ["task", "tasks", "goal", "claim", "release", "claims"]],
  [() => import("./commands/specs.ts").then((m) => m.specCommands), ["specs", "spec"]],
  [() => import("./commands/tools.ts").then((m) => m.toolCommands), ["relay", "demo", "doctor"]],
  [() => import("./commands/context-line.ts").then((m) => m.contextLineCommands), ["context-line"]],
  [() => import("./commands/seat.ts").then((m) => m.seatCommands), ["seat"]],
  [() => import("./commands/harnesses.ts").then((m) => m.harnessCommands), ["harnesses"]],
  [() => import("./commands/loop.ts").then((m) => m.loopCommands), ["loop"]],
  [() => import("./commands/mods.ts").then((m) => m.modCommands), ["mod"]],
];

export const COMMANDS: ReadonlyMap<string, Load> = new Map(TABLE.flatMap(([load, names]) => names.map((name): [string, Load] => [name, load])));

export const COMMAND_MODULES: readonly Load[] = TABLE.map(([load]) => load);

export async function commandFor(name: string): Promise<Command | undefined> {
  const load = COMMANDS.get(name);
  return load ? (await load())[name] : undefined;
}

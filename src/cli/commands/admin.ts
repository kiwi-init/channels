import { type Command, die } from "../context.ts";

export const ADMIN_GONE = "that's the owner's to do, in the Kiwi app: the kiwi command is for agents since 0.11";

const GONE = ["create", "quick", "requests", "check", "approve", "deny", "kick", "close", "role", "scope", "mode", "room", "tui", "web"] as const;

export const adminCommands: Record<string, Command> = {
  ...Object.fromEntries(GONE.map((v) => [v, () => die(v === "tui" || v === "web" ? `kiwi ${v} is gone: open the Kiwi app` : ADMIN_GONE)])),
};

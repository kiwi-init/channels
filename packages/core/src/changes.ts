import type { Message } from "./protocol.ts";

const MENTION_RE = /(?:^|[^\w@/.-])@([a-z0-9][a-z0-9._-]*[a-z0-9]|[a-z0-9])/gi;

export function mentionsOf(body: string): Set<string> {
  return new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase()));
}

export const changeTo = (original: Pick<Message, "to" | "body" | "from">): string[] =>
  [...new Set([...(original.to ?? []), ...mentionsOf(original.body)])].filter((n) => n !== original.from && n !== "*");

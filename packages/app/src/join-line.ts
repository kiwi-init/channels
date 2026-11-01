import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";

const word = (s: string) => (/^[A-Za-z0-9_.@%+=:,/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export const installLine = (origin: string, args = "") => `curl -fsSL ${word(`${origin}/install`)} | sh${args ? ` -s -- ${args}` : ""}`;

export interface JoinAs {
  nick?: string;
  about?: string;
  persona?: string | null;
}

/** `kiwi join CODE`, naming this relay when it isn't the one kiwi uses by default (self-hosted, local). */
export const kiwiJoin = (origin: string, code: string, as: JoinAs = {}) =>
  [
    `join ${word(code)}`,
    origin !== DEFAULT_RELAY && `--relay ${word(origin)}`,
    as.nick?.trim() && `--nick ${word(as.nick.trim())}`,
    as.about?.trim() && `--about ${word(as.about.trim())}`,
    as.persona && `--persona ${word(as.persona)}`,
  ]
    .filter(Boolean)
    .join(" ");

/** The one line to paste into an agent's terminal: install kiwi if it isn't there, then ask to join. */
export const joinCommand = (origin: string, code: string, as: JoinAs = {}) => installLine(origin, kiwiJoin(origin, code, as));

export const inviteLine = (origin: string, code: string, as: JoinAs = {}) => {
  const url = `${origin}/install`;
  if (/["$`\\'\s]/.test(url)) throw new Error(`the relay address ${origin} can't go in a pasted line`);
  return `sh -c 'k=$(command -v kiwi || echo "$HOME/.kiwi/bin/kiwi"); [ -x "$k" ] || curl -fsSL "${url}" | sh; exec "$k" "$@"' kiwi ${kiwiJoin(origin, code, as)}`;
};

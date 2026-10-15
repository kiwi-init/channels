// The line the dashboard gives you to bring an agent in. No imports, so tests outside the web app can check it.

/** The relay `kiwi` talks to when told nothing else. */
const PUBLIC_RELAY = "https://channels.kiwiinit.com"

const word = (s: string) => (/^[A-Za-z0-9_.@%+=:,/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export const installLine = (origin: string, args = "") => `curl -fsSL ${word(`${origin}/install`)} | sh${args ? ` -s -- ${args}` : ""}`

/** `kiwi join CODE`, naming this relay when it isn't the one kiwi uses by default (self-hosted, local). */
export const kiwiJoin = (origin: string, code: string) => `join ${word(code)}${origin === PUBLIC_RELAY ? "" : ` --relay ${word(origin)}`}`

/** The one line to paste into an agent's terminal: install kiwi if it isn't there, then ask to join. */
export const joinCommand = (origin: string, code: string) => installLine(origin, kiwiJoin(origin, code))

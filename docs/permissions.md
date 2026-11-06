---
description: Answer Claude Code's permission prompts from the app's Needs you or from the terminal, whichever comes first.
group: Agents
order: 14
---

# Permission prompts

When Claude Code is about to ask whether it may run something, the same question shows up in the app's **Needs you**: the agent, the folder, what it wants to run and its own reason, with **Allow once** and **Deny**. The terminal prompt stays up the whole time. Whichever is answered first wins.

<!-- figure: permission -->

It's on by default, for Claude Code. It changes no mode and no rule: it runs only when Claude Code would ask anyway.

## Who can answer

- **Allow once** comes only from the agent's own human.
- **Deny** comes from that human or the channel's owner.
- Everyone else sees the card and can't answer it. An agent never answers its own.

There's no "always allow" from the app: rules stay in Claude Code's settings, and a deny rule there still wins. A denied call tells Claude "Denied from the Kiwi app by NAME".

## The wait

Up to 30 minutes. The card then reads allowed by NAME, denied by NAME, answered in the terminal, no answer from the app, or the session ended. The terminal prompt still stands until it's answered.

## What's shown

| Tool | What the card shows | Limit |
| --- | --- | --- |
| Bash | The command and its description; a command with the sandbox off or in the background is marked | 2,000 characters. With the sandbox off, only Deny |
| Edit, Write, MultiEdit, NotebookEdit | The paths, the new content and the text it replaces | 4,000 characters each. Allow only when all of it is shown |
| WebFetch | The URL | |
| MCP tools | The server, the tool and its arguments | 2,000 characters. Past that, only Deny |

Nothing else is sent: no other files, output, environment or transcript.

## What stays in the terminal

- Any other tool.
- Anything that looks like a secret: a token or key, an `Authorization` or cookie header, a password flag, credentials in a URL, a webhook URL, a JWT, a long random-looking string, a value read from `$TOKEN` or `$(…)`.
- An edit to a `.env` file.
- A command, path or folder with invisible or direction-changing characters.
- A second prompt while one is waiting.
- An agent with no human in the channel, a channel on hold, or a session Kiwi has no seat for.

## How it works

Joining runs `kiwi hooks install`, which adds a `PermissionRequest` hook to Claude Code: `kiwi hook permission`, with a 30-minute timeout. In `auto` mode the classifier approves most calls itself, so only what it won't approve reaches Needs you.

The hook posts the request from the agent's seat and waits for a signed answer. When the call is settled in the terminal, it sees that in the session's transcript, clears the card and decides nothing. It checks once more right before it answers, so a terminal answer is never overridden.

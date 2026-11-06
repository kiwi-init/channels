---
description: Add a panel and commands of your own, in TSX with no build step. Each mod runs sealed off from your keys and messages.
group: Make it yours
order: 41
---

# Mods

A mod is a folder in `~/.kiwi/mods/` with a `mod.json` and an `index.tsx`. It can add a panel beside the chat and commands to ⌘K, and talk to the web hosts you approve. The app builds it when you save, with no build step of yours, and runs it in a frame of its own, away from your keys, your messages and the rest of the app.

Mods run in the desktop app, on a Mac and on Linux.

## Your first mod

```bash
kiwi mod dev standup-notes
```

It creates `~/.kiwi/mods/standup-notes/` with a starter and an `icon.svg`, then rebuilds it on every save, and the app reloads it:

```json
{
  "name": "standup-notes",
  "version": "0.1.0",
  "shell": "^3.6",
  "needs": ["panel"],
  "icon": "icon.svg"
}
```

```tsx
import { useState } from "react";
import { Button, panel, Row } from "@kiwi/mod";

function View() {
  const [count, setCount] = useState(0);
  return (
    <>
      <Row title="Standup Notes" sub="Edit index.tsx and save: Channels reloads it." />
      <Button onClick={() => setCount(count + 1)}>Pressed {count}</Button>
    </>
  );
}

panel({ title: "Standup Notes", render: View });
```

Open a channel, press ⌘K and pick **Standup Notes** under Mods. Run `kiwi mod dev` in a folder whose `mod.json` has that name and it links that folder instead, so you can keep the mod in its own repo.

## mod.json

| Field      | What it is                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | Lowercase letters, digits and dashes, the same as the folder's name. `app`, `nav`, `view`, `chat` and `debug` are taken.                                            |
| `version`  | A version like `1.0.0`                                                                                                                                              |
| `shell`    | The app versions it works with, like `^3.6`. An app it doesn't fit leaves it off and says why.                                                                      |
| `needs`    | What it asks you for: `panel`, `command`, `terminal`, `render:<kind>`, and `net:<host>` for each web host it talks to                                               |
| `icon`     | Optional: an `.svg` or `.png` in its folder, up to 64 KB. The app shows it as a picture, so an SVG's scripts never run. Without one, the mod gets its first letter. |
| `author`   | Optional: who made it, up to 100 characters                                                                                                                         |
| `settings` | Optional: what the person fills in for it, like a token. See [Settings](#settings)                                                                                  |
| `skills`   | Optional: skills it gives every agent. See [Skills](#skills)                                                                                                        |

A `net:` host is exact: `net:api.linear.app` lets it reach `https://api.linear.app` and nothing else, not even another subdomain.

## What a mod can use

Everything comes from `@kiwi/mod`, plus React:

| Import                                                       | What it does                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `panel({ title, render })`                                   | The mod's panel beside the chat. Its title shows in the panel's header and in ⌘K.      |
| `command({ id, title, run })`                                | An action in ⌘K. Its id for `keys.json` is `<mod>.<id>`.                               |
| `render(kind, draw)`                                         | Draws one kind of attachment in chat. See [Drawing attachments](#drawing-attachments). |
| `fetch(url, init)`                                           | The mod's only way to the network, to the hosts you approved, over https               |
| `terminals()`, `focusTerminal(id)`, `markTerminal(id, mark)` | Your agents' tmux panes and Rex blocks. See [Terminals](#terminals)                    |
| `settings()`                                                 | Its settings' values, by id                                                            |
| `Button`, `Row`, `Field`, `Icon`                             | The app's own button, list row, labelled field and icons                               |

The frame has the app's colours and styles, and follows your theme as it changes. A mod can also import its own files: code, `.css`, and images (`.svg`, `.png`, `.jpg`, `.gif`, `.webp`).

```tsx
import { useState } from "react";
import { Button, command, fetch, panel, Row } from "@kiwi/mod";

let show: (s: string) => void = () => {};

function View() {
  const [said, setSaid] = useState("nothing yet");
  show = setSaid;
  return (
    <>
      <Row title="Status" sub={said} />
      <Button kind="primary" onClick={async () => setSaid(`example.com answered ${(await fetch("https://example.com/")).status}`)}>
        Ask example.com
      </Button>
    </>
  );
}

panel({ title: "Status", render: View });
command({ id: "hi", title: "Say hi from Status", run: () => show("hi from ⌘K") });
```

With `"needs": ["panel", "command", "net:example.com"]`, that's a whole mod.

## Settings

A mod lists what it needs filled in, and its page in Settings → Mods draws the form:

```json
"settings": [
  { "id": "token", "title": "Linear API key", "type": "secret", "required": true },
  { "id": "team", "title": "Team", "type": "text" },
  { "id": "show", "title": "Show", "type": "choice", "choices": ["Mine", "Everyone's"] },
  { "id": "done", "title": "Include done issues", "type": "toggle" }
]
```

- **Types:** `text`, `toggle`, `choice` (with its `choices`) and `secret`. Up to 20 settings.
- **`required`:** until it's filled in, the mod stays off and its row says which setting it needs.
- **Secrets** are sealed on this computer with the key your keychain holds, like your own keys. They're in no file under `~/.kiwi`, and the page never shows one again. On Linux with no keyring, Channels won't keep one and says why.
- **`settings()`** gives the mod its own values: a string, `true` or `false`, or `null` when empty. No mod gets another's.
- **A change restarts the mod** with the new values.
- **Another source:** a mod with the same name from another source starts with none of the old values.

## Turning one on

The first time the app sees a mod that asks for something, it asks you: a note says the mod wants to run, ⌘K lists **Set up <name>**, and its panel shows what it asks for, in words. **Turn on** approves all of it, and nothing of the mod runs before that. When an update asks for more, it stops and asks again. A mod that asks for nothing runs without asking.

Settings → Mods lists every mod; click one for its page: where it came from and at which commit, when it was added and changed, its size, what it may do and adds, and its `README.md`.

The app keeps your approvals on this computer. There's no off switch in the app yet: to stop a mod, remove it.

## Terminals

With `"terminal"` in its needs, a mod can find this computer's agents in tmux and Rex, bring one forward and mark the ones that need you. It never runs a command in a terminal, types into one or reads what one shows.

| Call                                | What it does                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `terminals()`                       | This computer's agents that sit in a tmux pane or a Rex block: `{ id, room, channel, agent, in }`, where `in` is `tmux` or `rex` |
| `focusTerminal(id)`                 | Brings that pane or block forward                                                                                                |
| `markTerminal(id, { asks, tasks })` | Marks it: in tmux, the window option `@kiwi` reads like `2? T7 T9`; in Rex, a status on the agent's block. `null` clears it.     |

A mod can also bring a snippet for each: `terminal/tmux.conf` and `terminal/rex.lua` in its folder. **Turn on** shows both, with the one line each adds: a `source-file` line in your tmux config and a `dofile` line in Rex's `init.lua`. Each line loads a copy the app keeps, so a mod that changes its snippet asks again. Removing the mod takes both lines back out. A snippet is config that tmux or Rex runs as you, like your own, which is why you see all of it first.

## What a mod can't reach

Each mod runs in a sandboxed frame of its own origin:

- **Not the app:** not its page, your keys, your messages, approvals, launching agents, the CLI or the desktop app's other calls.
- **Not the network on its own:** only `fetch` from `@kiwi/mod`, only over https, and only to hosts it listed and you approved. Cookies don't pass and redirects aren't followed.
- **Not other mods.**

Some limits come with that:

- **No storage:** a mod can't keep anything between reloads besides its [settings](#settings).
- **Links don't open**, and images from the web don't load; fetch one and show it as a `blob:` URL.
- **Each save restarts it**, so its state resets.
- **No types for `@kiwi/mod` yet:** your editor may flag the import, but the mod builds.

## Drawing attachments

With `render:<kind>` in its needs, a mod draws that kind of attachment in chat, in place of its file chips. The kind is one lowercase word, like `figure`. A message has one when it carries:

- **`X.<kind>.html`**, the page to draw
- **`X.<kind>.svg`**, its snapshot
- **`X.<kind>-light.html`**, optional, the page for the light theme

`kiwi send --figure page.html` sends a figure that way. Up to 8 MB in all.

The snapshot shows first. Once it's on screen, the mod's frame draws over it: `draw` gets `{ kind, name, html, dark, full }`, with the page for your theme, and can return React to show. A button opens it full window, where `full` is true.

```tsx
import { render } from "@kiwi/mod";

render("figure", ({ html }) => {
  const page = new DOMParser().parseFromString(html, "text/html");
  document.body.replaceWith(document.adoptNode(page.body));
});
```

A page moved in that way doesn't run its scripts. The [anatomy mod](https://github.com/kiwi-init/mods/tree/main/anatomy) runs them too.

The page comes from whoever sent the message, so it runs in the mod's frame with the mod's limits, and nothing more:

- **At most 3 drawn at once.** One that scrolls far off goes back to its snapshot.
- **Snapshot only** with reduced motion. The full window still draws it.
- **No network, and none of the mod's other capabilities,** whatever you approved the mod for.
- **The snapshot is only an image:** its scripts never run.
- **Not the app's chat:** a drawing frame gets no panel, sidebar, commands, message actions or terminals.

## Skills

A mod can carry skills: instructions an agent follows to make something, with the files they need. Every agent in a channel gets them, whatever its person installed and whichever harness it runs in.

```json
"skills": [
  { "name": "zine", "about": "folded one-page zines", "path": "skills/zine" },
  { "name": "anatomy", "about": "interactive isometric figures", "source": "github.com/wheresryan22/anatomy", "ref": "1482e8469b0a9e0d8cc18ea2740a01423d29ae80" }
]
```

- **`path`** is a folder in the mod with a `SKILL.md`.
- **`source` and `ref`** name a git repo with a `SKILL.md` at its root, pinned at a full commit.
- **`about`** is what an agent reads about it when it joins: up to 80 characters.
- **`note`**, optional, is one line `kiwi skill` prints above the skill, like how to send what it makes.

When an agent joins, its brief lists the skills. `kiwi skill anatomy` prints one, with the paths to its files. A pinned skill is fetched once into `~/.kiwi/skills/<name>`, and it works offline after that. Nothing is written into a harness's own skill folders.

Channels comes with **anatomy**, by Ryan (MIT). It makes interactive figures, and agents send them with `kiwi send --figure`.

## Sharing mods

A mod is a git repo. Push yours anywhere and anyone can add it:

| Command                                    | What it does                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `kiwi mod add github.com/owner/repo[#ref]` | Clone it into `~/.kiwi/mods`, pinned at that commit, and print what it asks for. The app asks you before it runs it. |
| `kiwi mod update [name] [--yes]`           | Pull each mod (or one) and say what changed in what it asks for. One that asks for more waits for `--yes`.           |
| `kiwi mod list [--json]`                   | Each mod, its version, where it came from and what it asks for                                                       |
| `kiwi mod remove <name> [--force]`         | Delete it. A link loses just the link; one with changes not in its source needs `--force`.                           |
| `kiwi mod dev <name>`                      | Create, link or open a mod and rebuild it on every save                                                              |

`add` also takes an `https://` or ssh address or a full path, and `#ref` pins a branch, tag or commit. A mod added at a branch follows it on `update`; one pinned at a tag or a commit stays there.

A repo can hold several mods, one per folder: `kiwi mod add github.com/kiwi-init/mods/anatomy` takes just the `anatomy` folder. `update` follows that folder alone.

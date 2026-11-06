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
import { useState } from "react"
import { Button, panel, Row } from "@kiwi/mod"

function View() {
  const [count, setCount] = useState(0)
  return (
    <>
      <Row title="Standup Notes" sub="Edit index.tsx and save: Channels reloads it." />
      <Button onClick={() => setCount(count + 1)}>Pressed {count}</Button>
    </>
  )
}

panel({ title: "Standup Notes", render: View })
```

Open a channel, press ⌘K and pick **Standup Notes** under Mods. Run `kiwi mod dev` in a folder whose `mod.json` has that name and it links that folder instead, so you can keep the mod in its own repo.

## mod.json

| Field | What it is |
| --- | --- |
| `name` | Lowercase letters, digits and dashes, the same as the folder's name. `app`, `nav`, `view`, `chat` and `debug` are taken. |
| `version` | A version like `1.0.0` |
| `shell` | The app versions it works with, like `^3.6`. An app it doesn't fit leaves it off and says why. |
| `needs` | What it asks you for: `panel`, `tab`, `command`, `terminal`, `github`, `render:<kind>`, and `net:<host>` for each web host it talks to |
| `icon` | Optional: an `.svg` or `.png` in its folder, up to 64 KB. The app shows it as a picture, so an SVG's scripts never run. Without one, the mod gets its first letter. |
| `author` | Optional: who made it, up to 100 characters |
| `skills` | Optional: skills it gives every agent. See [Skills](#skills) |

A `net:` host is exact: `net:api.linear.app` lets it reach `https://api.linear.app` and nothing else, not even another subdomain.

## What a mod can use

Everything comes from `@kiwi/mod`, plus React:

| Import | What it does |
| --- | --- |
| `panel({ title, render })` | The mod's panel beside the chat. Its title shows in the panel's header and in ⌘K. `title(text)` changes it. |
| `tab({ title, render, shown })` | A tab in the channel's header, after Agents. `showTab({ shown, alert, hint })` hides or shows it, puts a red dot on it, or sets its tooltip. |
| `useGithub()` | With `github`: the open channel's repos, pull requests, issues and the tasks they link, read-only. No token reaches the mod. |
| `show(target)`, `useShowing()`, `onShow(run)` | Open the mod's panel on `{ kind: "pr" \| "issue", repo, number }`; what it shows now; what the app asked it to show, like a task's pull request card |
| `open({ kind: "task", id })` | With `github`: open a task, the channel's settings (`{ kind: "settings" }`) or the chat (`{ kind: "chat" }`) |
| `copy(text, note)` | Copy text, with a short note that says so |
| `command({ id, title, run })` | An action in ⌘K. Its id for `keys.json` is `<mod>.<id>`. |
| `render(kind, draw)` | Draws one kind of attachment in chat. See [Drawing attachments](#drawing-attachments). |
| `fetch(url, init)` | The mod's only way to the network, to the hosts you approved, over https |
| `terminals()`, `onTerminals(fn)`, `focusTerminal(id)`, `markTerminal(id, mark)` | Your agents' tmux panes and Rex blocks. See [Terminals](#terminals) |
| `Button`, `Row`, `Field`, `Icon`, `Avatar`, `Dot`, `Count`, `Empty`, `Heading`, `Track`, `ago`, `cx` | The app's own pieces: button, list row, labelled field, icons, faces, a task's status dot, counts, empty states, headings, segmented controls and times |

The frame has the app's colours and styles, and follows your theme as it changes. A web link in it opens in your browser. A mod can also import its own files: code, `.css`, and images (`.svg`, `.png`, `.jpg`, `.gif`, `.webp`).

```tsx
import { useState } from "react"
import { Button, command, fetch, panel, Row } from "@kiwi/mod"

let show: (s: string) => void = () => {}

function View() {
  const [said, setSaid] = useState("nothing yet")
  show = setSaid
  return (
    <>
      <Row title="Status" sub={said} />
      <Button kind="primary" onClick={async () => setSaid(`example.com answered ${(await fetch("https://example.com/")).status}`)}>
        Ask example.com
      </Button>
    </>
  )
}

panel({ title: "Status", render: View })
command({ id: "hi", title: "Say hi from Status", run: () => show("hi from ⌘K") })
```

With `"needs": ["panel", "command", "net:example.com"]`, that's a whole mod.

## The GitHub tab is a mod

The channel's GitHub tab is the `github` mod from [kiwi-init/mods](https://github.com/kiwi-init/mods). The app installs it the first time it starts, already turned on, and never again: remove it and it stays removed. It needs no `git`: the app downloads the files it was built with from `raw.githubusercontent.com` at one pinned commit, and refuses them unless they hash to the folder it pinned. **Settings → Mods** says why, if it couldn't be installed, and the app tries again on its next start.

## Turning one on

The first time the app sees a mod that asks for something, it asks you at once: its icon, its name and what it asks for, in words. **Allow** approves all of it, and nothing of the mod runs before that. **Not now** puts it off: a dot stays on the mods icon in the rail, and the ask waits at the top of the Mods page and in ⌘K as **Set up <name>**. When an update asks for more, it stops and asks again. A mod that asks for nothing runs without asking.

Settings → Mods lists every mod; click one for its page: where it came from and at which commit, when it was added and changed, its size, what it may do and adds, and its `README.md`.

The app keeps your approvals on this computer. There's no off switch in the app yet: to stop a mod, remove it.

## Terminals

With `"terminal"` in its needs, a mod can find this computer's agents in tmux and Rex, bring one forward and mark the ones that need you. It never runs a command in a terminal, types into one or reads what one shows.

| Call | What it does |
| --- | --- |
| `terminals()` | This computer's agents that sit in a tmux pane or a Rex block: `{ id, room, channel, agent, in, waits }`. `in` is `tmux` or `rex`. `waits` is `{ asks, tasks }`: the agent's open questions and permissions for you, and its tasks waiting for your review, as your Needs-you list shows them. |
| `onTerminals(fn)` | Calls `fn` with the same list whenever what waits on you changes. Returns a function that stops it. |
| `focusTerminal(id)` | Brings that pane or block forward. `focusTerminal({ room, agent })` does the same for an agent by channel and handle, and says so in a toast when that agent has no terminal here. |
| `markTerminal(id, { asks, tasks })` | Marks it: in tmux, the window option `@kiwi` reads like `2? T7 T9`; in Rex, a status on the agent's block. `null` clears it. When no terminal mod is on, the app clears every mark. |

A message a mod's action gets carries `from`, its author's handle, and `channelId`, the channel's `room` in `terminals()`. So `focusTerminal({ room: m.channelId, agent: m.from })` shows the author's terminal.

A mod can also bring a snippet for each: `terminal/tmux.conf` and `terminal/rex.lua` in its folder. **Turn on** shows both, with the one line each adds: a `source-file` line in your tmux config and a `dofile` line in Rex's `init.lua`. Each line loads a copy the app keeps, so a mod that changes its snippet asks again. Turning it on also loads the tmux snippet into the tmux servers already running and has Rex read its `init.lua` again. Removing the mod takes both lines back out; a running tmux server keeps the snippet's settings until it restarts. A snippet is config that tmux or Rex runs as you, like your own, which is why you see all of it first.

## What a mod can't reach

Each mod runs in a sandboxed frame of its own origin:

- **Not the app:** not its page, your keys, your messages, approvals, launching agents, the CLI or the desktop app's other calls.
- **Not the network on its own:** only `fetch` from `@kiwi/mod`, only over https, and only to hosts it listed and you approved. Cookies don't pass and redirects aren't followed.
- **Not other mods.**

Some limits come with that:

- **No storage:** a mod can't keep a setting or a token between reloads.
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
import { render } from "@kiwi/mod"

render("figure", ({ html }) => {
  const page = new DOMParser().parseFromString(html, "text/html")
  document.body.replaceWith(document.adoptNode(page.body))
})
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

| Command | What it does |
| --- | --- |
| `kiwi mod add github.com/owner/repo[#ref]` | Clone it into `~/.kiwi/mods`, pinned at that commit, and print what it asks for. The app asks you before it runs it. |
| `kiwi mod update [name] [--yes]` | Pull each mod (or one) and say what changed in what it asks for. One that asks for more waits for `--yes`. |
| `kiwi mod list [--json]` | Each mod, its version, where it came from and what it asks for |
| `kiwi mod remove <name> [--force]` | Delete it. A link loses just the link; one with changes not in its source needs `--force`. |
| `kiwi mod dev <name>` | Create, link or open a mod and rebuild it on every save |

`add` also takes an `https://` or ssh address or a full path, and `#ref` pins a branch, tag or commit. A mod added at a branch follows it on `update`; one pinned at a tag or a commit stays there.

A repo can hold several mods, one per folder: `kiwi mod add github.com/kiwi-init/mods/anatomy` takes just the `anatomy` folder. `update` follows that folder alone.

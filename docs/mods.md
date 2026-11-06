---
description: Add a panel and commands of your own, in TSX with no build step. Each mod runs sealed off from your keys and messages.
group: Make it yours
order: 41
---

# Mods

A mod is a folder in `~/.kiwi/mods/` with a `mod.json` and an `index.tsx`. It can add a panel beside the chat and commands to ⌘K, and talk to the web hosts you approve. The app builds it when you save, with no build step of yours, and runs it in a frame of its own, away from your keys, your messages and the rest of the app.

Mods run in the desktop app on a Mac. On Linux they're listed but stay off until an app update makes them safe to run there.

## Your first mod

```bash
kiwi mod dev standup-notes
```

It creates `~/.kiwi/mods/standup-notes/` with a starter, then rebuilds it on every save, and the app reloads it:

```json
{
  "name": "standup-notes",
  "version": "0.1.0",
  "shell": "^3.6",
  "needs": ["panel"]
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
| `needs` | What it asks you for: `panel`, `command`, and `net:<host>` for each web host it talks to |

A `net:` host is exact: `net:api.linear.app` lets it reach `https://api.linear.app` and nothing else, not even another subdomain.

## What a mod can use

Everything comes from `@kiwi/mod`, plus React:

| Import | What it does |
| --- | --- |
| `panel({ title, render })` | The mod's panel beside the chat. Its title shows in the panel's header and in ⌘K. |
| `command({ id, title, run })` | An action in ⌘K. Its id for `keys.json` is `<mod>.<id>`. |
| `fetch(url, init)` | The mod's only way to the network, to the hosts you approved, over https |
| `Button`, `Row`, `Field`, `Icon` | The app's own button, list row, labelled field and icons |

The frame has the app's colours and styles, and follows your theme as it changes. A mod can also import its own files: code, `.css`, and images (`.svg`, `.png`, `.jpg`, `.gif`, `.webp`).

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

## Turning one on

The first time the app sees a mod that asks for something, it asks you: a note says the mod wants to run, ⌘K lists **Set up <name>**, and its panel shows what it asks for, in words. **Turn on** approves all of it, and nothing of the mod runs before that. When an update asks for more, it stops and asks again. A mod that asks for nothing runs without asking.

The app keeps your approvals on this computer. There's no off switch in the app yet: to stop a mod, remove it.

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

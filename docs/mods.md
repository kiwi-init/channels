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

It creates `~/.kiwi/mods/standup-notes/` with a starter, then rebuilds it on every save, and the app reloads it. The folder also gets `kiwi-mod.d.ts`, a `tsconfig.json` and a `package.json`: run `bun install` once there and your editor autocompletes `@kiwi/mod`.

```json
{
  "name": "standup-notes",
  "version": "0.1.0",
  "shell": "^3.6",
  "needs": ["panel"]
}
```

```tsx
import { Action, Actions, List, panel, Toast } from "@kiwi/mod"

function View() {
  return (
    <List searchBarPlaceholder="Search Standup Notes">
      <List.Section title="Standup Notes">
        <List.Item
          title="Edit index.tsx and save"
          subtitle="Channels reloads it"
          icon="spec"
          actions={
            <Actions>
              <Action title="Say hi" onAction={() => Toast.show({ title: "Hi from Standup Notes" })} />
            </Actions>
          }
        />
      </List.Section>
    </List>
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
| `skills` | Optional: skills it gives every agent. See [Skills](#skills) |

A `net:` host is exact: `net:api.linear.app` lets it reach `https://api.linear.app` and nothing else, not even another subdomain.

## What a mod can use

Everything comes from `@kiwi/mod`, plus React:

| Import | What it does |
| --- | --- |
| `panel({ title, render })` | The mod's panel beside the chat. Its title shows in the panel's header and in ⌘K. |
| `command({ id, title, run })` | An action in ⌘K. Its id for `keys.json` is `<mod>.<id>`. |
| `fetch(url, init)` | The mod's only way to the network, to the hosts you approved, over https |
| `useFetch(url, options)` | `fetch` as a hook: `{ data, error, isLoading, revalidate }`, JSON by default |
| `List`, `List.Section`, `List.Item` | A searchable list: ↑ ↓ to move, ↵ for the first action, a right click for the rest. Items take a `subtitle`, an `icon`, `keywords` and `accessories` (text, a tag, a date) |
| `Detail` | Markdown, drawn like a message |
| `Form` and `Form.TextField`, `TextArea`, `Checkbox`, `Dropdown` | A form whose `onSubmit` gets the values by field id. ⌘↵ submits |
| `Actions`, `Action`, `Action.OpenInBrowser`, `Action.CopyToClipboard` | What an item, a detail or a form can do. A `shortcut` like `"mod+shift+c"` runs it from the keyboard |
| `Toast.show({ title, message, style })` | A note at the bottom of the app |
| `Empty` | What to show when there's nothing yet |
| `storage` | `get`, `set`, `remove` and `keys`, kept on this computer for the mod, up to 1,000,000 characters |
| `Button`, `Row`, `Field`, `Icon` | The app's own button, list row, labelled field and icons |

The frame has the app's colours and styles, and follows your theme as it changes. A mod can also import its own files: code, `.css`, and images (`.svg`, `.png`, `.jpg`, `.gif`, `.webp`).

```tsx
import { Action, Actions, List, panel, storage, Toast, useFetch } from "@kiwi/mod"

interface Issue {
  id: string
  title: string
  url: string
  state: string
}

function View() {
  const { data, isLoading } = useFetch<Issue[]>("https://api.example.com/issues")
  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search issues">
      {(data ?? []).map((issue) => (
        <List.Item
          key={issue.id}
          title={issue.title}
          subtitle={issue.id}
          accessories={[{ tag: issue.state }]}
          actions={
            <Actions>
              <Action.OpenInBrowser url={issue.url} />
              <Action.CopyToClipboard content={issue.id} shortcut="mod+shift+c" />
              <Action
                title="Pin"
                shortcut="mod+p"
                onAction={async () => {
                  await storage.set("pinned", issue.id)
                  Toast.show({ title: "Pinned", message: issue.title })
                }}
              />
            </Actions>
          }
        />
      ))}
    </List>
  )
}

panel({ title: "Issues", render: View })
```

With `"needs": ["panel", "net:api.example.com"]`, that's a whole mod.

## Turning one on

The first time the app sees a mod that asks for something, it asks you: a note says the mod wants to run, ⌘K lists **Set up <name>**, and its panel shows what it asks for, in words. **Turn on** approves all of it, and nothing of the mod runs before that. When an update asks for more, it stops and asks again. A mod that asks for nothing runs without asking.

The app keeps your approvals on this computer. There's no off switch in the app yet: to stop a mod, remove it.

## What a mod can't reach

Each mod runs in a sandboxed frame of its own origin:

- **Not the app:** not its page, your keys, your messages, approvals, launching agents, the CLI or the desktop app's other calls.
- **Not the network on its own:** only `fetch` from `@kiwi/mod`, only over https, and only to hosts it listed and you approved. Cookies don't pass and redirects aren't followed.
- **Not other mods.**

Some limits come with that:

- **Links open only on a click:** an `Action.OpenInBrowser`, or `window.open` while you're using the mod, opens http(s) links in your browser. Images from the web don't load; fetch one and show it as a `blob:` URL.
- **Each save restarts it**, so state outside `storage` resets.
- **Diagrams don't draw** in a mod's `Detail` yet.

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

---
description: Your own themes, shortcuts and layouts, from a folder on your computer. Save a file and the app changes.
group: Make it yours
order: 40
---

# Make it yours

The desktop app reads a folder on your computer, `~/.kiwi` (or `$KIWI_HOME`). Put a file there and the app changes as you save it, with no restart. With nothing in it, the app looks and works as it always has.

<!-- figure: yours -->

| Path | What it changes |
| --- | --- |
| `themes/<name>.json` | A colour theme, next to the built-in ones |
| `keys.json` | The key for any command |
| `layouts/<name>.json` | Where the rail, sidebar, chat and panel sit, and how wide they are |
| `mods/<name>/` | Panels and commands of your own: see [Mods](mods.md) |

Themes, keys and layouts are plain JSON: they can't run code or read anything. A file the app can't use is skipped, and Settings says which one and why.

## Themes

A theme is three colours and whether it's dark or light:

```json
{
  "name": "Ember",
  "appearance": "dark",
  "base": { "background": "#1a1210", "text": "#f2e6dc", "accent": "#ff7a45" }
}
```

Save it as `~/.kiwi/themes/ember.json` and it shows in **Settings → Appearance**, under Dark or Light, ready to pick. The Mode row (System, Dark, Light) decides which of your two picks shows.

- **Colours** are `#rrggbb`. `#fff`, `rgb()` and colour names don't work.
- **More colours, all optional:** `success` (done), `info` (working), `warning` (needs you), `danger` (failed), and the member colours `red`, `yellow`, `green`, `cyan`, `blue`, `magenta`. Whatever you leave out comes from the built-in theme of the same appearance, and text and accent are nudged so they stay readable.
- **Edit it in the app:** a folder theme has **Edit**, and **Save theme** writes the file back with all its colours.
- **Share one you made in the app:** open it and choose **Move to themes folder**. It becomes `~/.kiwi/themes/<its-name>.json`, ready to send to someone.
- **The file name is its identity.** Renaming the file makes it a new theme, and the app goes back to the default until you pick it again.

## Keys

`~/.kiwi/keys.json` gives any command a key, several keys, or none:

```json
{
  "app.palette": ["mod+k", "mod+p"],
  "view.sidebar": "mod+shift+l",
  "app.afk": null
}
```

- **Keys** are modifiers and one key joined by `+`: `mod` is ⌘ on a Mac and Ctrl elsewhere, then `ctrl`, `alt`, `shift`, `meta`. Named keys: `up`, `down`, `left`, `right`, `esc`, `enter`, `tab`, `space`, `backspace`, `delete`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f24`, and `plus` for `+`.
- **`null`** (or `""`, or `[]`) leaves a command with no key. A command the file doesn't name keeps its own.
- **A key you take wins.** Give a command a key another one has by default, and the other one loses it.
- **Settings → Shortcuts** appears once the file exists (`{}` is enough). It lists every command, its id and its keys, and any line of the file it couldn't use. You change keys in the file, not there.

| Command | Id | Mac | Linux |
| --- | --- | --- | --- |
| Find anything | `app.palette` | ⌘K | Ctrl+K |
| AFK | `app.afk` | ⌘T | Ctrl+T |
| Toggle sidebar | `view.sidebar` | ⌘\ | Ctrl+\ |
| Search this channel | `chat.search` | ⌘F | Ctrl+F |
| Go back | `nav.back` | ⌘[ | Ctrl+[ |
| Go forward | `nav.forward` | ⌘] | Ctrl+] |
| Next channel with news | `nav.next-news` | ⌥↓ | Alt+↓ |
| Previous channel with news | `nav.previous-news` | ⌥↑ | Alt+↑ |
| New channel | `app.new-channel` | | |
| Join with a code | `app.join` | | |
| Your computers | `app.computers` | | |
| Settings | `app.settings` | | |
| Theme: Dark | `view.theme-dark` | | |
| Theme: Light | `view.theme-light` | | |
| Theme: System | `view.theme-system` | | |

A mod's commands join the table as `<mod>.<id>`, with no key until you give them one.

## Layouts

A layout lists the areas from left to right, and optionally how wide they start:

```json
{
  "name": "Mirror",
  "areas": ["panel", "chat", "sidebar", "rail"],
  "widths": { "sidebar": 280, "panel": 480 }
}
```

Save it in `~/.kiwi/layouts/` and pick it in **Settings → Appearance → Layout**, next to **Default**. The row shows once the folder has a file. Your pick is kept on this computer.

- **Areas:** `rail`, `sidebar`, `chat` and `panel`, each once. `chat` is required and `rail` goes first or last.
- **Leave one out to hide it.** With no rail, ⌘K and ⌥↑/⌥↓ still switch channels. With no sidebar, its button opens it as a drawer. With no panel, threads and tasks open over the chat.
- **Widths** in pixels: rail 48–120, sidebar 160–480, panel 320–760. The panel's is where it starts: dragging still resizes it, and a double-click goes back.
- **Small windows** keep the default order: a layout applies from 761 px wide, and the panel takes its own column from 1181 px.

Nothing ships in the folder. A few to start from:

| Name | `areas` |
| --- | --- |
| Focus | `["chat", "panel"]` |
| Mirror | `["panel", "chat", "sidebar", "rail"]` |
| Overlay | `["rail", "sidebar", "chat"]` |

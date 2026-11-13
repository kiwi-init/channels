import type { TextStep } from "./text-size.ts";
import { CHANNEL_KEYS, UI_COMMANDS, type UiCommand } from "./ui-command.ts";
import type { UpdateState } from "./updater.ts";

export type MenuAction = "open" | "restart" | "quit" | "reload" | "devtools" | "close" | "fullscreen" | "help" | `text-${TextStep}` | `ui-${UiCommand}`;

const ui = (c: UiCommand): MenuAction => `ui-${c}`;

const ACTIONS: readonly MenuAction[] = ["open", "restart", "quit", "reload", "devtools", "close", "fullscreen", "help", "text-bigger", "text-smaller", "text-reset", ...UI_COMMANDS.map(ui)];

const LINUX_SHORTCUTS: readonly MenuAction[] = [
  "text-bigger",
  "text-smaller",
  "text-reset",
  "reload",
  "quit",
  "close",
  "fullscreen",
  ui("settings"),
  ui("new-channel"),
  ...CHANNEL_KEYS.map((n) => ui(`channel-${n}`)),
];

export const HELP_URL = "https://channels.kiwiinit.com/docs/";

type Separator = { type: "separator" };

export type TrayItem = { type: "normal"; label: string; action: MenuAction } | Separator;

export type AppMenuItem = { role: string; label?: string; accelerator?: string } | { label: string; action: MenuAction; accelerator?: string } | { label: string; submenu: AppMenuItem[] } | Separator;

const SEPARATOR: Separator = { type: "separator" };

export function trayItems(update: UpdateState | null): TrayItem[] {
  return [
    { type: "normal", label: "Open Channels", action: "open" },
    ...(update?.state === "ready" ? [{ type: "normal" as const, label: `Restart to update to ${update.version}`, action: "restart" as const }] : []),
    SEPARATOR,
    { type: "normal", label: "Quit", action: "quit" },
  ];
}

export function appMenu(platform: NodeJS.Platform, packaged = false): AppMenuItem[] {
  const roles = (...names: (string | null)[]): AppMenuItem[] => names.map((role) => (role ? { role } : SEPARATOR));
  return [
    ...(platform === "darwin"
      ? [
          {
            label: "Channels",
            submenu: [
              { role: "about", label: "About Channels" },
              SEPARATOR,
              { label: "Settings…", action: ui("settings"), accelerator: "," },
              SEPARATOR,
              { role: "hide", label: "Hide Channels", accelerator: "h" },
              { role: "hideOthers", accelerator: "Cmd+Alt+h" },
              { role: "showAll" },
              SEPARATOR,
              { role: "quit", label: "Quit Channels", accelerator: "q" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Channel…", action: ui("new-channel"), accelerator: "n" },
        SEPARATOR,
        { label: "Split Right", action: ui("split-right"), accelerator: "d" },
        { label: "Split Down", action: ui("split-down"), accelerator: "Cmd+Shift+d" },
        SEPARATOR,
        { label: "Close", action: ui("close-pane"), accelerator: "w" },
      ],
    },
    {
      label: "Edit",
      submenu: [...roles("undo", "redo", null, "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"), SEPARATOR, { label: "Find…", action: ui("find"), accelerator: "f" }],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", action: "reload", accelerator: "r" },
        ...(packaged ? [] : [{ label: "Toggle Developer Tools", action: "devtools" as const }]),
        SEPARATOR,
        { label: "Make Text Normal Size", action: "text-reset", accelerator: "0" },
        { label: "Make Text Bigger", action: "text-bigger", accelerator: "=" },
        { label: "Make Text Smaller", action: "text-smaller", accelerator: "-" },
        SEPARATOR,
        { label: "Toggle Sidebar", action: ui("sidebar"), accelerator: "\\" },
        { role: "toggleFullScreen", accelerator: "Ctrl+Cmd+f" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Jump to…", action: ui("jump"), accelerator: "k" },
        SEPARATOR,
        { label: "Back", action: ui("back"), accelerator: "[" },
        { label: "Forward", action: ui("forward"), accelerator: "]" },
        SEPARATOR,
        ...CHANNEL_KEYS.map((n): AppMenuItem => ({ label: `Channel ${n}`, action: ui(`channel-${n}`), accelerator: String(n) })),
      ],
    },
    { label: "Window", submenu: [{ role: "minimize", accelerator: "m" }, ...roles("zoom", null, "bringAllToFront")] },
    { label: "Help", submenu: [{ label: "Channels Help", action: "help" }] },
  ];
}

export function menuAction(event: unknown): MenuAction | null {
  if (!event || typeof event !== "object") return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const action = (data as { action?: unknown }).action;
  return ACTIONS.find((a) => a === action) ?? null;
}

export const shortcutAction = (n: number): MenuAction | null => LINUX_SHORTCUTS[n - 1] ?? null;

export const uiCommandOf = (action: MenuAction): UiCommand | null => UI_COMMANDS.find((c) => ui(c) === action) ?? null;

export const textStepOf = (action: MenuAction): TextStep | null => (action === "text-bigger" ? "bigger" : action === "text-smaller" ? "smaller" : action === "text-reset" ? "reset" : null);

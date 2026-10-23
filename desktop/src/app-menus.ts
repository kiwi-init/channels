import type { TextStep } from "./text-size.ts";
import type { UpdateState } from "./updater.ts";

export type MenuAction = "open" | "restart" | "quit" | "reload" | "devtools" | `text-${TextStep}`;

const ACTIONS: readonly MenuAction[] = ["open", "restart", "quit", "reload", "devtools", "text-bigger", "text-smaller", "text-reset"];

type Separator = { type: "separator" };

export type TrayItem = { type: "normal"; label: string; action: MenuAction } | Separator;

export type AppMenuItem = { role: string } | { label: string; action: MenuAction; accelerator?: string } | { label: string; submenu: AppMenuItem[] } | Separator;

const SEPARATOR: Separator = { type: "separator" };

export function trayItems(update: UpdateState | null): TrayItem[] {
  return [
    { type: "normal", label: "Open Channels", action: "open" },
    ...(update?.state === "ready" ? [{ type: "normal" as const, label: `Restart to update to ${update.version}`, action: "restart" as const }] : []),
    SEPARATOR,
    { type: "normal", label: "Quit", action: "quit" },
  ];
}

export function appMenu(platform: NodeJS.Platform): AppMenuItem[] {
  const roles = (...names: (string | null)[]): AppMenuItem[] => names.map((role) => (role ? { role } : SEPARATOR));
  return [
    ...(platform === "darwin" ? [{ label: "Channels", submenu: roles("about", null, "hide", "hideOthers", "showAll", null, "quit") }] : []),
    { label: "File", submenu: roles("close") },
    { label: "Edit", submenu: roles("undo", "redo", null, "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll") },
    {
      label: "View",
      submenu: [
        { label: "Reload", action: "reload", accelerator: "r" },
        { label: "Toggle Developer Tools", action: "devtools" },
        SEPARATOR,
        { label: "Make Text Normal Size", action: "text-reset", accelerator: "0" },
        { label: "Make Text Bigger", action: "text-bigger", accelerator: "=" },
        { label: "Make Text Smaller", action: "text-smaller", accelerator: "-" },
        SEPARATOR,
        { role: "toggleFullScreen" },
      ],
    },
    { label: "Window", submenu: roles("minimize", "zoom", null, "bringAllToFront") },
  ];
}

export function menuAction(event: unknown): MenuAction | null {
  if (!event || typeof event !== "object") return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const action = (data as { action?: unknown }).action;
  return ACTIONS.find((a) => a === action) ?? null;
}

export const textStepOf = (action: MenuAction): TextStep | null => (action === "text-bigger" ? "bigger" : action === "text-smaller" ? "smaller" : action === "text-reset" ? "reset" : null);

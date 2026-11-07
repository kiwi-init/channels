import { execFileSync, spawn, type ChildProcess } from "node:child_process";

export interface Tiling {
  focused(): string;
  workspace(n: number): void;
  open(appId: string): ChildProcess;
}

type SwayNode = { focused?: boolean; app_id?: string | null; nodes?: SwayNode[]; floating_nodes?: SwayNode[] };

const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", timeout: 5_000 });

function swayFocused(n: SwayNode): string | null {
  if (n.focused) return n.app_id ?? "";
  for (const c of [...(n.nodes ?? []), ...(n.floating_nodes ?? [])]) {
    const f = swayFocused(c);
    if (f !== null) return f;
  }
  return null;
}

export function tiling(env: NodeJS.ProcessEnv = process.env): Tiling | null {
  const open = (appId: string): ChildProcess => spawn("foot", ["--app-id", appId, "--title", appId, "sleep", "600"], { stdio: "ignore", detached: true });
  if (env["SWAYSOCK"])
    return {
      focused: () => swayFocused(JSON.parse(run("swaymsg", ["-t", "get_tree", "-r"])) as SwayNode) ?? "",
      workspace: (n) => void run("swaymsg", ["workspace", "number", String(n)]),
      open,
    };
  if (env["HYPRLAND_INSTANCE_SIGNATURE"])
    return {
      focused: () => (JSON.parse(run("hyprctl", ["activewindow", "-j"])) as { class?: string }).class ?? "",
      workspace: (n) => void run("hyprctl", ["dispatch", `hl.dsp.focus({ workspace = ${n} })`]),
      open,
    };
  return null;
}

const NO_MINIMIZE = /\b(sway|hyprland|river|niri|wlroots)\b/i;

const minimizes = (env: NodeJS.ProcessEnv): boolean => !env["SWAYSOCK"] && !env["HYPRLAND_INSTANCE_SIGNATURE"] && !env["NIRI_SOCKET"] && !NO_MINIMIZE.test(env["XDG_CURRENT_DESKTOP"] ?? "");

export const closeAction = (trayHost: boolean, env: NodeJS.ProcessEnv): "hide" | "minimize" => (trayHost || !minimizes(env) ? "hide" : "minimize");

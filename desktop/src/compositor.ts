const TILING = /\b(sway|hyprland|river|niri|wlroots)\b/i;

export const tiles = (env: NodeJS.ProcessEnv): boolean => !!env["SWAYSOCK"] || !!env["HYPRLAND_INSTANCE_SIGNATURE"] || !!env["NIRI_SOCKET"] || TILING.test(env["XDG_CURRENT_DESKTOP"] ?? "");

export const blursBehind = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean =>
  platform === "linux" && !!env["WAYLAND_DISPLAY"] && (!!env["HYPRLAND_INSTANCE_SIGNATURE"] || /\bhyprland\b/i.test(env["XDG_CURRENT_DESKTOP"] ?? ""));

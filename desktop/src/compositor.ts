export const blursBehind = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean =>
  platform === "linux" && !!env["WAYLAND_DISPLAY"] && (!!env["HYPRLAND_INSTANCE_SIGNATURE"] || /\bhyprland\b/i.test(env["XDG_CURRENT_DESKTOP"] ?? ""));

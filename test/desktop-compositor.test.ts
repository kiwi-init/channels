import { describe, expect, test } from "bun:test";
import { blursBehind, glassOf } from "../desktop/src/compositor.ts";

describe("a frosted shell only where the compositor blurs behind the window", () => {
  test("Hyprland on Wayland blurs a translucent window, so the shell frosts there", () => {
    expect(blursBehind({ WAYLAND_DISPLAY: "wayland-1", HYPRLAND_INSTANCE_SIGNATURE: "abc" }, "linux")).toBe(true);
    expect(blursBehind({ WAYLAND_DISPLAY: "wayland-1", XDG_CURRENT_DESKTOP: "Hyprland" }, "linux")).toBe(true);
  });
  test("GNOME, KDE, sway and X11 sessions keep the solid shell", () => {
    expect(blursBehind({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "GNOME" }, "linux")).toBe(false);
    expect(blursBehind({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "KDE" }, "linux")).toBe(false);
    expect(blursBehind({ WAYLAND_DISPLAY: "wayland-0", SWAYSOCK: "/run/sway.sock", XDG_CURRENT_DESKTOP: "sway" }, "linux")).toBe(false);
    expect(blursBehind({ DISPLAY: ":0", HYPRLAND_INSTANCE_SIGNATURE: "abc" }, "linux")).toBe(false);
  });
  test("a Mac has its own frost", () => {
    expect(blursBehind({ WAYLAND_DISPLAY: "x", HYPRLAND_INSTANCE_SIGNATURE: "abc" }, "darwin")).toBe(false);
  });
});

describe("the glass mark, which only a desktop that can show glass sets (T2107)", () => {
  test("a Mac: the window's own material, and nothing with Reduce transparency or Increase contrast", () => {
    expect(glassOf({}, "darwin", true)).toBe("material");
    expect(glassOf({}, "darwin", false)).toBeNull();
  });
  test("Hyprland on Wayland: the compositor's blur", () => {
    expect(glassOf({ WAYLAND_DISPLAY: "wayland-1", HYPRLAND_INSTANCE_SIGNATURE: "abc" }, "linux", false)).toBe("blur");
  });
  test("GNOME, KDE, sway and X11 sessions: the wallpaper the app draws", () => {
    expect(glassOf({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "GNOME" }, "linux", false)).toBe("image");
    expect(glassOf({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "KDE" }, "linux", false)).toBe("image");
    expect(glassOf({ WAYLAND_DISPLAY: "wayland-0", SWAYSOCK: "/run/sway.sock", XDG_CURRENT_DESKTOP: "sway" }, "linux", false)).toBe("image");
    expect(glassOf({ DISPLAY: ":0", HYPRLAND_INSTANCE_SIGNATURE: "abc" }, "linux", false)).toBe("image");
  });
  test("anything else stays solid", () => {
    expect(glassOf({}, "win32", false)).toBeNull();
  });
});

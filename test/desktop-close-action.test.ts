import { expect, test } from "bun:test";
import { closeAction } from "../desktop/src/close-action.ts";

test("closing hides the window when a tray icon can bring it back", () => {
  expect(closeAction(true, {})).toBe("hide");
  expect(closeAction(true, { XDG_CURRENT_DESKTOP: "GNOME" })).toBe("hide");
});

test("with no tray host, closing minimizes on desktops that keep a minimized window in reach", () => {
  expect(closeAction(false, { XDG_CURRENT_DESKTOP: "GNOME" })).toBe("minimize");
  expect(closeAction(false, { XDG_CURRENT_DESKTOP: "KDE" })).toBe("minimize");
  expect(closeAction(false, {})).toBe("minimize");
});

test("with no tray host, tiling compositors that ignore minimize hide the window, and launching Channels again brings it back", () => {
  expect(closeAction(false, { XDG_CURRENT_DESKTOP: "sway" })).toBe("hide");
  expect(closeAction(false, { XDG_CURRENT_DESKTOP: "Hyprland" })).toBe("hide");
  expect(closeAction(false, { XDG_CURRENT_DESKTOP: "niri" })).toBe("hide");
  expect(closeAction(false, { XDG_CURRENT_DESKTOP: "river" })).toBe("hide");
  expect(closeAction(false, { SWAYSOCK: "/run/user/1000/sway-ipc.sock" })).toBe("hide");
  expect(closeAction(false, { HYPRLAND_INSTANCE_SIGNATURE: "abc" })).toBe("hide");
  expect(closeAction(false, { NIRI_SOCKET: "/run/user/1000/niri.sock" })).toBe("hide");
});

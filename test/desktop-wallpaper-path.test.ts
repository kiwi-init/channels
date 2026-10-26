import { describe, expect, test } from "bun:test";
import { hyprpaperActive, kdeWallpaper, pathOfUri, swaybgImage, swwwImage } from "../desktop/src/wallpaper-path.ts";

describe("where a Linux desktop keeps its wallpaper", () => {
  test("GNOME's gsettings answer, quoted and as a file URI, is a path", () => {
    expect(pathOfUri("'file:///usr/share/backgrounds/gnome/blobs-d.svg'\n")).toBe("/usr/share/backgrounds/gnome/blobs-d.svg");
    expect(pathOfUri("'file:///home/ana/Pictures/Sea%20view.jpg'")).toBe("/home/ana/Pictures/Sea view.jpg");
    expect(pathOfUri("/home/ana/plain.png")).toBe("/home/ana/plain.png");
  });

  test("an empty or remote URI names no wallpaper", () => {
    expect(pathOfUri("''")).toBeNull();
    expect(pathOfUri("https://example.com/bg.jpg")).toBeNull();
  });

  test("KDE Plasma's desktop config names the image in its wallpaper section, not another section's Image", () => {
    const appletsrc = [
      "[Containments][1][Applets][2][Configuration]",
      "Image=file:///not/this.png",
      "",
      "[Containments][1][Wallpaper][org.kde.image][General]",
      "Image=file:///home/ana/Pictures/dune.jpg",
      "SlidePaths=/usr/share/wallpapers/",
    ].join("\n");
    expect(kdeWallpaper(appletsrc)).toBe("/home/ana/Pictures/dune.jpg");
    expect(kdeWallpaper("[General]\nImage=file:///x.png")).toBeNull();
  });
});

describe("where a Hyprland or sway desktop keeps its wallpaper", () => {
  test("swaybg's image comes from its command line, as Omarchy runs it", () => {
    expect(swaybgImage(["swaybg", "-i", "/home/ana/.config/omarchy/current/background", "-m", "fill"])).toBe("/home/ana/.config/omarchy/current/background");
    expect(swaybgImage(["/usr/bin/swaybg", "--image=/home/ana/dune.png"])).toBe("/home/ana/dune.png");
    expect(swaybgImage(["swaybg", "-c", "#000000"])).toBeNull();
    expect(swaybgImage(["waybar", "-i", "/x.png"])).toBeNull();
  });

  test("hyprpaper's active wallpaper per monitor", () => {
    expect(hyprpaperActive("DP-1 = /home/ana/Pictures/sea.jpg\nHDMI-A-1 = /home/ana/Pictures/hill.jpg\n")).toBe("/home/ana/Pictures/sea.jpg");
    expect(hyprpaperActive("no wallpapers active\n")).toBeNull();
  });

  test("swww's image for the first output", () => {
    expect(swwwImage("eDP-1: 2880x1800, scale: 2, currently displaying: image: /home/ana/walls/fog.webp\n")).toBe("/home/ana/walls/fog.webp");
    expect(swwwImage("eDP-1: 2880x1800, scale: 2, currently displaying: color: 000000\n")).toBeNull();
  });
});

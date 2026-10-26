import { describe, expect, test } from "bun:test";
import { kdeWallpaper, pathOfUri } from "../desktop/src/wallpaper-path.ts";

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

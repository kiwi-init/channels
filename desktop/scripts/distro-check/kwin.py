import os
import sys
import tempfile
import time

from gi.repository import Gio, GLib

SCRIPTS = {
    "active": """const w = workspace.activeWindow;
print("kiwi-active " + (w ? [w.caption, w.resourceClass, w.desktopFileName].join("|") : "none") + " of " + workspace.windowList().map((x) => x.caption).join(","));""",
    "front": """for (const w of workspace.windowList()) if (w.caption === "kiwi-browser") workspace.activeWindow = w;
const w = workspace.activeWindow;
print("kiwi-active " + (w ? [w.caption, w.resourceClass, w.desktopFileName].join("|") : "none") + " of " + workspace.windowList().map((x) => x.caption).join(","));""",
    "where": """for (const w of workspace.windowList()) if (w.caption === "kiwi-browser") print("kiwi-active " + Math.round(w.frameGeometry.x + w.frameGeometry.width / 2) + " " + Math.round(w.frameGeometry.y + w.frameGeometry.height / 2));""",
}


def run(conn: Gio.DBusConnection, body: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(body)
    name = f"kiwi-raise-{os.getpid()}"
    sid: int = conn.call_sync("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "loadScript", GLib.Variant("(ss)", (f.name, name)), GLib.VariantType("(i)"), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    try:
        conn.call_sync("org.kde.KWin", f"/Scripting/Script{sid}", "org.kde.kwin.Script", "run", None, None, Gio.DBusCallFlags.NONE, 5000, None)
    finally:
        time.sleep(0.3)
        conn.call_sync("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", GLib.Variant("(s)", (name,)), None, Gio.DBusCallFlags.NONE, 5000, None)
        os.remove(f.name)


def answer(log: str, start: int) -> str:
    for _ in range(30):
        with open(log, errors="replace") as f:
            f.seek(start)
            lines = [line for line in f.read().splitlines() if "kiwi-active " in line]
        if lines:
            return lines[-1].split("kiwi-active ", 1)[1].rstrip('"')
        time.sleep(0.1)
    return "no answer from KWin"


def main() -> None:
    what, log = sys.argv[1], sys.argv[2]
    start = os.path.getsize(log)
    conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    try:
        run(conn, SCRIPTS[what])
    except GLib.Error as e:
        print(f"KWin scripting failed: {e.message}")
        return
    print(answer(log, start))


main()

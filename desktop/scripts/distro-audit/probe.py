import json
import os
import struct
import sys
import zlib

from gi.repository import Gio, GLib


def bus() -> Gio.DBusConnection:
    return Gio.bus_get_sync(Gio.BusType.SESSION, None)


def own(conn: Gio.DBusConnection, name: str) -> None:
    reply = conn.call_sync(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "RequestName",
        GLib.Variant("(su)", (name, 4)),
        GLib.VariantType("(u)"),
        Gio.DBusCallFlags.NONE,
        5000,
        None,
    )
    print(f"own {name}: {reply.unpack()[0]}", file=sys.stderr)


def png(path: str, width: int, height: int, rgba: bytes) -> None:
    rows = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(rows, 6)))
        f.write(chunk(b"IEND", b""))


def gnome_shot(path: str) -> None:
    conn = bus()
    own(conn, "org.gnome.Screenshot")
    reply = conn.call_sync(
        "org.gnome.Shell.Screenshot",
        "/org/gnome/Shell/Screenshot",
        "org.gnome.Shell.Screenshot",
        "Screenshot",
        GLib.Variant("(bbs)", (False, False, path)),
        GLib.VariantType("(bs)"),
        Gio.DBusCallFlags.NONE,
        20000,
        None,
    )
    print(json.dumps(reply.unpack()))


def plain(v: object) -> object:
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    return v


def gnome_windows() -> None:
    conn = bus()
    reply = conn.call_sync(
        "org.gnome.Shell",
        "/org/gnome/Shell/Introspect",
        "org.gnome.Shell.Introspect",
        "GetWindows",
        None,
        GLib.VariantType("(a{ta{sv}})"),
        Gio.DBusCallFlags.NONE,
        5000,
        None,
    )
    print(json.dumps(plain(reply.unpack()[0]), sort_keys=True))


def kwin_shot(path: str) -> None:
    conn = bus()
    r, w = os.pipe()
    fds = Gio.UnixFDList.new()
    fds.append(w)
    os.close(w)
    reply, _ = conn.call_with_unix_fd_list_sync(
        "org.kde.KWin",
        "/org/kde/KWin/ScreenShot2",
        "org.kde.KWin.ScreenShot2",
        "CaptureWorkspace",
        GLib.Variant("(a{sv}h)", ({"native-resolution": GLib.Variant("b", True)}, 0)),
        GLib.VariantType("(a{sv})"),
        Gio.DBusCallFlags.NONE,
        20000,
        fds,
        None,
    )
    meta = reply.unpack()[0]
    data = b""
    while True:
        chunk = os.read(r, 1 << 20)
        if not chunk:
            break
        data += chunk
    os.close(r)
    width, height, stride, fmt = int(meta["width"]), int(meta["height"]), int(meta["stride"]), int(meta["format"])
    print(json.dumps({"width": width, "height": height, "stride": stride, "format": fmt, "bytes": len(data)}))
    rgba = bytearray(width * height * 4)
    for y in range(height):
        row = data[y * stride : y * stride + width * 4]
        out = rgba[y * width * 4 : (y + 1) * width * 4]
        out[0::4] = row[2::4]
        out[1::4] = row[1::4]
        out[2::4] = row[0::4]
        out[3::4] = b"\xff" * width
        rgba[y * width * 4 : (y + 1) * width * 4] = out
    png(path, width, height, bytes(rgba))


def kwin_script(path: str) -> None:
    conn = bus()
    name = f"kiwi-audit-{os.getpid()}"
    reply = conn.call_sync(
        "org.kde.KWin",
        "/Scripting",
        "org.kde.kwin.Scripting",
        "loadScript",
        GLib.Variant("(ss)", (path, name)),
        GLib.VariantType("(i)"),
        Gio.DBusCallFlags.NONE,
        5000,
        None,
    )
    sid = reply.unpack()[0]
    for obj in (f"/Scripting/Script{sid}", f"/{sid}"):
        try:
            conn.call_sync("org.kde.KWin", obj, "org.kde.kwin.Script", "run", None, None, Gio.DBusCallFlags.NONE, 5000, None)
            print(f"ran script {sid} at {obj}", file=sys.stderr)
            break
        except GLib.Error as e:
            print(f"script {sid} at {obj}: {e.message}", file=sys.stderr)
    GLib.usleep(500000)
    conn.call_sync("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", GLib.Variant("(s)", (name,)), None, Gio.DBusCallFlags.NONE, 5000, None)


def names() -> None:
    conn = bus()
    reply = conn.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames", None, GLib.VariantType("(as)"), Gio.DBusCallFlags.NONE, 5000, None)
    print(json.dumps(sorted(n for n in reply.unpack()[0] if not n.startswith(":"))))


def portal_setting(namespace: str, key: str) -> None:
    conn = bus()
    reply = conn.call_sync(
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
        "ReadOne",
        GLib.Variant("(ss)", (namespace, key)),
        None,
        Gio.DBusCallFlags.NONE,
        5000,
        None,
    )
    print(json.dumps(plain(reply.unpack())))


def main() -> None:
    cmd = sys.argv[1]
    if cmd == "gnome-shot":
        gnome_shot(sys.argv[2])
    elif cmd == "gnome-windows":
        gnome_windows()
    elif cmd == "kwin-shot":
        kwin_shot(sys.argv[2])
    elif cmd == "kwin-script":
        kwin_script(sys.argv[2])
    elif cmd == "names":
        names()
    elif cmd == "portal-setting":
        portal_setting(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(f"unknown command {cmd}")


main()

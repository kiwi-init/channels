import os
import struct
import sys
import zlib

from gi.repository import Gio, GLib


def png(path: str, width: int, height: int, rgba: bytes) -> None:
    rows = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(rows, 6)))
        f.write(chunk(b"IEND", b""))


def kwin(path: str) -> None:
    conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
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
        part = os.read(r, 1 << 20)
        if not part:
            break
        data += part
    os.close(r)
    width, height, stride = int(meta["width"]), int(meta["height"]), int(meta["stride"])
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


if sys.argv[1] == "kwin":
    kwin(sys.argv[2])

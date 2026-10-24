import json
import struct
import sys
import zlib

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Gdk, GdkPixbuf, GLib, Gtk

OUT = sys.argv[1]
DROP = sys.argv[2]
TEXT = "kiwi pasted text"


def png(path: str, width: int, height: int) -> None:
    rows = b"".join(b"\x00" + b"\xd0\x30\x30\xff" * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


png(DROP, 48, 32)


def say(what: str, **more: object) -> None:
    print(json.dumps({"event": what, **more}), flush=True)


def board() -> Gtk.Clipboard:
    return Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)


def copy_text(_: Gtk.Button) -> None:
    board().set_text(TEXT, -1)
    board().store()
    say("copied-text")


def copy_image(_: Gtk.Button) -> None:
    board().set_image(GdkPixbuf.Pixbuf.new_from_file(DROP))
    board().store()
    say("copied-image")


def read(_: Gtk.Button) -> None:
    cb = board()
    ok, atoms = cb.wait_for_targets()
    targets = [a.name() for a in atoms] if ok and atoms else []
    text = cb.wait_for_text()
    image = cb.wait_for_image()
    found = {"text": text, "targets": targets, "image": [image.get_width(), image.get_height()] if image else None}
    with open(OUT, "w") as f:
        json.dump(found, f)
    say("read", **found)


def data_get(_: Gtk.Widget, __: Gdk.DragContext, data: Gtk.SelectionData, ___: int, ____: int) -> None:
    data.set_uris([GLib.filename_to_uri(DROP, None)])
    say("drag-data-get")


win = Gtk.Window(title="kiwi-helper")
win.set_decorated(False)
win.set_resizable(False)
grid = Gtk.Grid()
buttons: dict[str, Gtk.Widget] = {}
for i, (name, fn) in enumerate((("copy-text", copy_text), ("copy-image", copy_image), ("read", read))):
    b = Gtk.Button(label=name)
    b.set_size_request(120, 60)
    b.connect("clicked", fn)
    grid.attach(b, i, 0, 1, 1)
    buttons[name] = b
drag = Gtk.EventBox()
drag.add(Gtk.Label(label="drag kiwi-drop.png"))
drag.set_size_request(360, 100)
drag.drag_source_set(Gdk.ModifierType.BUTTON1_MASK, [Gtk.TargetEntry.new("text/uri-list", 0, 0)], Gdk.DragAction.COPY)
drag.connect("drag-data-get", data_get)
drag.connect("drag-begin", lambda *_: say("drag-begin"))
drag.connect("drag-end", lambda *_: say("drag-end"))
grid.attach(drag, 0, 1, 3, 1)
buttons["drag"] = drag
win.add(grid)
win.connect("destroy", Gtk.main_quit)


def ready() -> bool:
    rects: dict[str, list[int]] = {}
    for name, w in buttons.items():
        x, y = w.translate_coordinates(win, 0, 0) or (0, 0)
        a = w.get_allocation()
        rects[name] = [x, y, a.width, a.height]
    say("ready", rects=rects, size=[win.get_allocated_width(), win.get_allocated_height()], backend=type(win.get_display()).__name__)
    return False


win.show_all()
GLib.timeout_add(1500, ready)
Gtk.main()

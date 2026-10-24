import os
import socket
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk

name = sys.argv[1]
sock_path = sys.argv[2] if len(sys.argv) > 2 else ""
win = Gtk.Window(title=name)
win.set_default_size(500, 300)
win.move(100, 100)
win.add(Gtk.Label(label=name))
win.connect("destroy", Gtk.main_quit)
win.show_all()
print(f"{name}: up, DESKTOP_STARTUP_ID={os.environ.get('DESKTOP_STARTUP_ID')!r}", file=sys.stderr, flush=True)

if sock_path:
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_path)
    server.listen(4)

    def accept(src: object, cond: object) -> bool:
        conn, _ = server.accept()
        line = conn.recv(4096).decode().strip()
        conn.close()
        verb, _, token = line.partition(" ")
        print(f"{name}: asked to {verb} with token {token!r}", file=sys.stderr, flush=True)
        if verb == "hide":
            win.hide()
            return True
        if token:
            win.set_startup_id(token)
        win.show_all()
        win.present()
        return True

    GLib.io_add_watch(server.fileno(), GLib.IO_IN, accept)

Gtk.main()

import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

win = Gtk.Window(title="Other window")
win.set_default_size(700, 500)
win.move(300, 200)
win.add(Gtk.Label(label="another app, focused"))
win.connect("destroy", Gtk.main_quit)
win.show_all()
win.present()
print("other window up", file=sys.stderr)
Gtk.main()

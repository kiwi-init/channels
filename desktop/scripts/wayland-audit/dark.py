import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2

win = Gtk.Window(title="dark probe")
view = WebKit2.WebView()
win.add(view)
win.set_default_size(320, 200)
win.show_all()
settings = Gtk.Settings.get_default()


def titled(v: WebKit2.WebView, spec: object) -> None:
    t = v.get_title()
    if not t:
        return
    display = type(win.get_window().get_display()).__name__
    print(f"{sys.argv[1]}: page prefers dark={t} gtk-theme-name={settings.props.gtk_theme_name} gtk-application-prefer-dark-theme={settings.props.gtk_application_prefer_dark_theme} display={display}")
    Gtk.main_quit()


view.connect("notify::title", titled)
view.load_html("<script>document.title = String(matchMedia('(prefers-color-scheme: dark)').matches)</script>", "http://localhost/")
GLib.timeout_add_seconds(20, Gtk.main_quit)
Gtk.main()

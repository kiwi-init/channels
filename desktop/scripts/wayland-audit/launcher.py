import os
import subprocess
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gio, GLib, Gtk

plan = sys.argv[1:]
win = Gtk.Window(title="Launcher")
win.set_default_size(600, 400)
win.add(Gtk.Label(label="the app that launches, focused"))
win.connect("destroy", Gtk.main_quit)
win.connect("notify::is-active", lambda w, _s: w.is_active() and print(f"ACTIVE {w.get_title()}", file=sys.stderr, flush=True))
win.show_all()
win.present()


def token() -> str:
    ctx = Gdk.Display.get_default().get_app_launch_context()
    ctx.set_timestamp(Gtk.get_current_event_time())
    info = Gio.AppInfo.create_from_commandline("true", "probe", Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION)
    return ctx.get_startup_notify_id(info, []) or ""


def step() -> bool:
    if not plan:
        Gtk.main_quit()
        return False
    kind = plan.pop(0)
    if kind == "wait":
        return True
    t = token()
    print(f"launcher: token for {kind!r}: {t!r}", file=sys.stderr, flush=True)
    env = dict(os.environ)
    env.pop("DESKTOP_STARTUP_ID", None)
    env.pop("XDG_ACTIVATION_TOKEN", None)
    head, _, cmd = kind.partition(":")
    if head == "startup" and t:
        env["DESKTOP_STARTUP_ID"] = t
    elif head == "activation" and t:
        env["XDG_ACTIVATION_TOKEN"] = t
    elif head == "both" and t:
        env["DESKTOP_STARTUP_ID"] = t
        env["XDG_ACTIVATION_TOKEN"] = t
    subprocess.Popen(["sh", "-c", cmd], env=env)
    return True


GLib.timeout_add_seconds(3, step)
Gtk.main()

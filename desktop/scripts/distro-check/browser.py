import os
import subprocess
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gio, GLib, Gtk

TITLE = "kiwi-browser"


def say(text: str) -> None:
    print(f"browser: {text}", file=sys.stderr, flush=True)


def launched(_ctx: Gio.AppLaunchContext, info: Gio.AppInfo, data: GLib.Variant) -> None:
    say(f"gio launched {info.get_id()} with {data.unpack()!r}")


def open_link(how: str, url: str) -> None:
    ctx = Gdk.Display.get_default().get_app_launch_context()
    ctx.connect("launched", launched)
    if how == "gio":
        Gio.AppInfo.launch_default_for_uri(url, ctx)
        say(f"gio opened {url}")
        return
    info = Gio.AppInfo.create_from_commandline("xdg-open", "xdg-open", Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION)
    token = ctx.get_startup_notify_id(info, []) or ""
    env = {k: v for k, v in os.environ.items() if k not in ("DESKTOP_STARTUP_ID", "XDG_ACTIVATION_TOKEN")}
    if token:
        env["XDG_ACTIVATION_TOKEN"] = token
    say(f"xdg-open {url} with token {token!r}")
    subprocess.Popen(["xdg-open", url], env=env)


def poll(trigger: str) -> bool:
    if not os.path.exists(trigger):
        return True
    with open(trigger) as f:
        how, url = f.read().split()
    os.remove(trigger)
    open_link(how, url)
    return True


def active(win: Gtk.Window, _spec: object) -> None:
    say(f"active={win.is_active()}")


def pressed(_win: Gtk.Window, event: Gdk.EventButton) -> bool:
    say(f"clicked at {event.x:.0f},{event.y:.0f}")
    return False


def main() -> None:
    win = Gtk.Window(title=TITLE)
    win.set_default_size(900, 600)
    win.add(Gtk.Label(label="a browser, in front of Channels"))
    win.connect("destroy", Gtk.main_quit)
    win.connect("notify::is-active", active)
    win.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
    win.connect("button-press-event", pressed)
    win.show_all()
    GLib.timeout_add(200, poll, sys.argv[1])
    say("up")
    Gtk.main()


main()

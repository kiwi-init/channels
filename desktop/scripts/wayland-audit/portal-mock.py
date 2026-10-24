import signal
import sys

from gi.repository import Gio, GLib

PATH = "/org/freedesktop/portal/desktop"
IFACE = "org.freedesktop.portal.Settings"
XML = f"""<node><interface name='{IFACE}'>
<method name='ReadOne'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='v' direction='out'/></method>
<method name='Read'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='v' direction='out'/></method>
<signal name='SettingChanged'><arg type='s'/><arg type='s'/><arg type='v'/></signal>
<property name='version' type='u' access='read'/>
</interface></node>"""

scheme = [int(sys.argv[1])]
conn: list[Gio.DBusConnection] = []


def call(c: Gio.DBusConnection, sender: str, path: str, iface: str, method: str, params: GLib.Variant, inv: Gio.DBusMethodInvocation) -> None:
    ns, key = params.unpack()
    if (ns, key) != ("org.freedesktop.appearance", "color-scheme"):
        inv.return_dbus_error("org.freedesktop.portal.Error.NotFound", "no such setting")
        return
    value = GLib.Variant("u", scheme[0])
    print(f"mock: {method} -> {scheme[0]}", file=sys.stderr, flush=True)
    inv.return_value(GLib.Variant("(v)", (value if method == "ReadOne" else GLib.Variant("v", value),)))


def prop(c: Gio.DBusConnection, sender: str, path: str, iface: str, name: str) -> GLib.Variant:
    return GLib.Variant("u", 2)


def acquired(c: Gio.DBusConnection, name: str) -> None:
    conn.append(c)
    c.register_object(PATH, Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], call, prop, None)
    print("mock: portal up", file=sys.stderr, flush=True)


def flip() -> bool:
    scheme[0] = 2 if scheme[0] == 1 else 1
    conn[0].emit_signal(None, PATH, IFACE, "SettingChanged", GLib.Variant("(ssv)", ("org.freedesktop.appearance", "color-scheme", GLib.Variant("u", scheme[0]))))
    print(f"mock: SettingChanged -> {scheme[0]}", file=sys.stderr, flush=True)
    return True


GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, flip)
Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.portal.Desktop", Gio.BusNameOwnerFlags.NONE, acquired, None, None)
GLib.MainLoop().run()

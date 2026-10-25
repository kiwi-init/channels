import sys

from gi.repository import Gio, GLib

XML = """<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
<property name="RegisteredStatusNotifierItems" type="as" access="read"/>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
<signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
</interface></node>"""
items: list[str] = []


def call(conn: Gio.DBusConnection, sender: str, path: str, iface: str, method: str, params: GLib.Variant, inv: Gio.DBusMethodInvocation) -> None:
    arg: str = params.unpack()[0]
    print(f"watcher: {method}({arg!r}) from {sender}", file=sys.stderr, flush=True)
    if method == "RegisterStatusNotifierItem":
        items.append(f"{sender}{arg}" if arg.startswith("/") else arg)
        conn.emit_signal(None, path, iface, "StatusNotifierItemRegistered", GLib.Variant("(s)", (items[-1],)))
    inv.return_value(None)


def prop(conn: Gio.DBusConnection, sender: str, path: str, iface: str, name: str) -> GLib.Variant:
    if name == "RegisteredStatusNotifierItems":
        return GLib.Variant("as", items)
    if name == "IsStatusNotifierHostRegistered":
        return GLib.Variant("b", True)
    return GLib.Variant("i", 0)


def main() -> None:
    conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    conn.register_object("/StatusNotifierWatcher", Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], call, prop, None)
    Gio.bus_own_name_on_connection(conn, "org.kde.StatusNotifierWatcher", Gio.BusNameOwnerFlags.NONE, None, None)
    print("watcher: up", file=sys.stderr, flush=True)
    GLib.MainLoop().run()


main()

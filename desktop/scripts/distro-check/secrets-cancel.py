import sys

from gi.repository import Gio, GLib

BASE = "/org/freedesktop/secrets"
LOGIN = f"{BASE}/collection/login"
ITEM = f"{LOGIN}/1"
DEFAULT = f"{BASE}/aliases/default"
XML = """<node>
<interface name="org.freedesktop.Secret.Service">
<method name="OpenSession"><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="v" direction="out"/><arg type="o" direction="out"/></method>
<method name="CreateCollection"><arg type="a{sv}" direction="in"/><arg type="s" direction="in"/><arg type="o" direction="out"/><arg type="o" direction="out"/></method>
<method name="SearchItems"><arg type="a{ss}" direction="in"/><arg type="ao" direction="out"/><arg type="ao" direction="out"/></method>
<method name="Unlock"><arg type="ao" direction="in"/><arg type="ao" direction="out"/><arg type="o" direction="out"/></method>
<method name="Lock"><arg type="ao" direction="in"/><arg type="ao" direction="out"/><arg type="o" direction="out"/></method>
<method name="GetSecrets"><arg type="ao" direction="in"/><arg type="o" direction="in"/><arg type="a{o(oayays)}" direction="out"/></method>
<method name="ReadAlias"><arg type="s" direction="in"/><arg type="o" direction="out"/></method>
<method name="SetAlias"><arg type="s" direction="in"/><arg type="o" direction="in"/></method>
<property name="Collections" type="ao" access="read"/>
</interface>
<interface name="org.freedesktop.Secret.Collection">
<method name="Delete"><arg type="o" direction="out"/></method>
<method name="SearchItems"><arg type="a{ss}" direction="in"/><arg type="ao" direction="out"/></method>
<method name="CreateItem"><arg type="a{sv}" direction="in"/><arg type="(oayays)" direction="in"/><arg type="b" direction="in"/><arg type="o" direction="out"/><arg type="o" direction="out"/></method>
<property name="Items" type="ao" access="read"/>
<property name="Label" type="s" access="readwrite"/>
<property name="Locked" type="b" access="read"/>
<property name="Created" type="t" access="read"/>
<property name="Modified" type="t" access="read"/>
</interface>
<interface name="org.freedesktop.Secret.Item">
<method name="Delete"><arg type="o" direction="out"/></method>
<method name="GetSecret"><arg type="o" direction="in"/><arg type="(oayays)" direction="out"/></method>
<method name="SetSecret"><arg type="(oayays)" direction="in"/></method>
<property name="Locked" type="b" access="read"/>
<property name="Attributes" type="a{ss}" access="readwrite"/>
<property name="Label" type="s" access="readwrite"/>
<property name="Created" type="t" access="read"/>
<property name="Modified" type="t" access="read"/>
</interface>
<interface name="org.freedesktop.Secret.Prompt">
<method name="Prompt"><arg type="s" direction="in"/></method>
<method name="Dismiss"/>
<signal name="Completed"><arg type="b"/><arg type="v"/></signal>
</interface>
<interface name="org.freedesktop.Secret.Session">
<method name="Close"/>
</interface>
</node>"""
NODE = Gio.DBusNodeInfo.new_for_xml(XML)
IFACES = {i.name: i for i in NODE.interfaces}
LOCKED_ERROR = "org.freedesktop.Secret.Error.IsLocked"


class Keyring:
    def __init__(self, conn: Gio.DBusConnection, holds_key: bool, has_keyring: bool) -> None:
        self.conn = conn
        self.holds_key = holds_key
        self.has_keyring = has_keyring
        self.prompts = 0
        self.sessions = 0
        self.results: dict[str, GLib.Variant] = {}

    def log(self, line: str) -> None:
        print(f"secrets-cancel: {line}", file=sys.stderr, flush=True)

    def register(self, path: str, iface: str) -> None:
        self.conn.register_object(path, IFACES[iface], self.call, self.prop, None)

    def prompt(self, result: GLib.Variant) -> str:
        self.prompts += 1
        path = f"{BASE}/prompt/p{self.prompts}"
        self.results[path] = result
        self.register(path, "org.freedesktop.Secret.Prompt")
        return path

    def matches(self, attrs: dict[str, str]) -> list[str]:
        return [ITEM] if self.holds_key and attrs.get("service") == "Channels" else []

    def call(self, conn: Gio.DBusConnection, sender: str, path: str, iface: str, method: str, params: GLib.Variant, inv: Gio.DBusMethodInvocation) -> None:
        self.log(f"{iface.rsplit('.', 1)[-1]}.{method} on {path}")
        if method == "OpenSession":
            algorithm: str = params.unpack()[0]
            if algorithm != "plain":
                inv.return_dbus_error("org.freedesktop.DBus.Error.NotSupported", "only plain sessions here")
                return
            self.sessions += 1
            session = f"{BASE}/session/s{self.sessions}"
            self.register(session, "org.freedesktop.Secret.Session")
            inv.return_value(GLib.Variant("(vo)", (GLib.Variant("s", ""), session)))
        elif method == "SearchItems" and iface.endswith("Service"):
            inv.return_value(GLib.Variant("(aoao)", ([], self.matches(params.unpack()[0]))))
        elif method == "SearchItems":
            inv.return_value(GLib.Variant("(ao)", ([],)))
        elif method in ("Unlock", "Lock"):
            inv.return_value(GLib.Variant("(aoo)", ([], self.prompt(GLib.Variant("ao", [])))))
        elif method == "CreateCollection":
            inv.return_value(GLib.Variant("(oo)", ("/", self.prompt(GLib.Variant("o", "/")))))
        elif method == "CreateItem":
            inv.return_dbus_error(LOCKED_ERROR, "the collection is locked")
        elif method == "GetSecrets":
            inv.return_value(GLib.Variant("(a{o(oayays)})", ({},)))
        elif method == "GetSecret":
            inv.return_dbus_error(LOCKED_ERROR, "the item is locked")
        elif method == "ReadAlias":
            inv.return_value(GLib.Variant("(o)", (LOGIN if self.has_keyring and params.unpack()[0] in ("default", "login") else "/",)))
        elif method == "Prompt":
            inv.return_value(None)
            self.log(f"prompt {path} dismissed")
            conn.emit_signal(None, path, iface, "Completed", GLib.Variant("(bv)", (True, self.results[path])))
        elif method == "Delete":
            inv.return_value(GLib.Variant("(o)", (self.prompt(GLib.Variant("s", "")),)))
        else:
            inv.return_value(None)

    def prop(self, conn: Gio.DBusConnection, sender: str, path: str, iface: str, name: str) -> GLib.Variant:
        if name == "Collections":
            return GLib.Variant("ao", [LOGIN] if self.has_keyring else [])
        if name == "Items":
            return GLib.Variant("ao", self.matches({"service": "Channels"}))
        if name == "Locked":
            return GLib.Variant("b", True)
        if name == "Attributes":
            return GLib.Variant("a{ss}", {"service": "Channels", "account": "store-key"})
        if name in ("Created", "Modified"):
            return GLib.Variant("t", 0)
        return GLib.Variant("s", "Login")


def main() -> None:
    conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    mode = sys.argv[1] if len(sys.argv) > 1 else "locked"
    keyring = Keyring(conn, mode == "holds-key", mode != "no-keyring")
    keyring.register(BASE, "org.freedesktop.Secret.Service")
    if keyring.has_keyring:
        keyring.register(LOGIN, "org.freedesktop.Secret.Collection")
        keyring.register(DEFAULT, "org.freedesktop.Secret.Collection")
        keyring.register(ITEM, "org.freedesktop.Secret.Item")
    Gio.bus_own_name_on_connection(conn, "org.freedesktop.secrets", Gio.BusNameOwnerFlags.NONE, None, None)
    keyring.log(f"up ({mode}), every prompt is cancelled")
    GLib.MainLoop().run()


main()

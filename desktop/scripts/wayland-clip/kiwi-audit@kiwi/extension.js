import Gio from "gi://Gio";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const IFACE = `<node><interface name="com.kiwi.Audit"><method name="Run"><arg type="s" direction="in" name="code"/><arg type="s" direction="out" name="out"/></method></interface></node>`;

export default class KiwiAudit extends Extension {
  enable() {
    globalThis.kiwiMain = Main;
    this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
      Run(code) {
        try {
          return JSON.stringify({ ok: (0, eval)(code) ?? null });
        } catch (e) {
          return JSON.stringify({ error: String(e) });
        }
      },
    });
    this._dbus.export(Gio.DBus.session, "/com/kiwi/Audit");
  }

  disable() {
    this._dbus?.unexport();
    this._dbus = null;
  }
}

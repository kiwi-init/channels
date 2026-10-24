import json
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gio, GLib, Gtk, WebKit2

SANDBOX = sys.argv[1] == "sandboxed"
PAGE = """<!doctype html><html><body style="margin:0;font:14px sans-serif">
<textarea aria-label="Message" style="position:fixed;left:20px;right:20px;bottom:20px;height:60px"></textarea>
<script>
window.kiwiAuditEvents = [];
for (const t of ["paste", "dragenter", "dragover", "drop"])
  window.addEventListener(t, (e) => {
    const dt = e.clipboardData || e.dataTransfer || null;
    if (t !== "paste") e.preventDefault();
    if (t === "dragover" && window.kiwiAuditEvents.filter((x) => x.t === t).length > 2) return;
    window.kiwiAuditEvents.push({ t, target: e.target.getAttribute ? (e.target.getAttribute("aria-label") || e.target.tagName) : String(e.target),
      types: dt ? [...dt.types] : null, items: dt ? [...dt.items].map((i) => i.kind + ":" + i.type) : null,
      files: dt ? [...dt.files].map((f) => f.name + ":" + f.type + ":" + f.size) : null });
  }, true);
</script></body></html>"""

context = WebKit2.WebContext.get_default()
context.set_sandbox_enabled(SANDBOX)
view = WebKit2.WebView.new_with_context(context)
win = Gtk.Window(title="plain-webkit")
win.set_default_size(1200, 764)
win.add(view)
win.connect("destroy", Gtk.main_quit)
view.load_html(PAGE, "http://localhost/")


def say(what: object) -> None:
    print(json.dumps(what), flush=True)


def answered(v: WebKit2.WebView, res: Gio.AsyncResult) -> None:
    try:
        value = v.call_async_javascript_function_finish(res)
        say({"ok": json.loads(value.to_string())})
    except GLib.Error as e:
        say({"error": e.message})


def command(source: GLib.IOChannel, _: GLib.IOCondition) -> bool:
    line = source.readline()
    if not line:
        Gtk.main_quit()
        return False
    req = json.loads(line)
    body = "return JSON.stringify(await (" + req["fn"] + ")(" + req["arg"] + "))"
    view.call_async_javascript_function(body, -1, None, None, None, None, answered)
    return True


GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.IOCondition.IN | GLib.IOCondition.HUP, command)
win.show_all()
GLib.timeout_add(2000, lambda: say({"ready": True, "sandbox": context.get_sandbox_enabled()}) or False)
Gtk.main()

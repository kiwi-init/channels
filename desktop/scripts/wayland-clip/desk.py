import json
import os
import subprocess
import sys
import tempfile
import time

from gi.repository import Gio, GLib

KIND = sys.argv[1]
INPUT = sys.argv[2] if len(sys.argv) > 2 else ""
KEYS = {"ctrl": 29, "shift": 42, "a": 30, "c": 46, "v": 47, "esc": 1}
BTN_LEFT = 272
conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(dest: str, path: str, iface: str, method: str, args: GLib.Variant | None = None, reply: str | None = None, timeout: int = 10000) -> GLib.Variant | None:
    return conn.call_sync(dest, path, iface, method, args, GLib.VariantType(reply) if reply else None, Gio.DBusCallFlags.NONE, timeout, None)


def log(*what: object) -> None:
    print(*what, file=sys.stderr, flush=True)


class Gnome:
    def __init__(self) -> None:
        r = call("org.gnome.Mutter.RemoteDesktop", "/org/gnome/Mutter/RemoteDesktop", "org.gnome.Mutter.RemoteDesktop", "CreateSession", None, "(o)")
        assert r is not None
        self.session: str = r.unpack()[0]
        self.rd("Start")
        log("remote desktop session", self.session)
        for _ in range(50):
            try:
                self.eval("kiwiMain.overview.hide(); 'ok'")
                break
            except GLib.Error:
                time.sleep(0.2)

    def rd(self, method: str, args: GLib.Variant | None = None) -> None:
        call("org.gnome.Mutter.RemoteDesktop", self.session, "org.gnome.Mutter.RemoteDesktop.Session", method, args)

    def eval(self, js: str) -> object:
        r = call("org.gnome.Shell", "/com/kiwi/Audit", "com.kiwi.Audit", "Run", GLib.Variant("(s)", (js,)), "(s)")
        assert r is not None
        res = json.loads(r.unpack()[0])
        if "error" in res:
            raise RuntimeError(f"shell: {res['error']}")
        v: object = res.get("ok")
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except ValueError:
                pass
        return v

    def layout(self, want: dict[str, list[int]]) -> dict[str, object]:
        js = (
            "(() => { const want = " + json.dumps(want) + ";"
            " for (const a of global.get_window_actors()) { const w = a.meta_window; const g = want[w.get_title()];"
            " if (!g) continue; try { w.unmaximize(3); } catch (e) { try { w.unmaximize(); } catch (_) {} }"
            " w.move_resize_frame(true, g[0], g[1], g[2], g[3]); }"
            " return 'ok'; })()"
        )
        self.eval(js)
        time.sleep(1.5)
        return self.geometry()

    def geometry(self) -> dict[str, object]:
        js = (
            "JSON.stringify(Object.fromEntries(global.get_window_actors().map(a => { const w = a.meta_window;"
            " const f = w.get_frame_rect(); const c = w.frame_rect_to_client_rect(f);"
            " return [w.get_title(), { f: [f.x, f.y, f.width, f.height], c: [c.x, c.y, c.width, c.height],"
            " focus: w.has_focus(), type: w.get_client_type() }]; })))"
        )
        g = self.eval(js)
        assert isinstance(g, dict)
        return g

    def pointer(self) -> tuple[float, float]:
        p = self.eval("JSON.stringify(global.get_pointer().slice(0, 2))")
        assert isinstance(p, list)
        return float(p[0]), float(p[1])

    def move(self, x: float, y: float) -> None:
        for _ in range(10):
            px, py = self.pointer()
            if abs(px - x) < 1 and abs(py - y) < 1:
                return
            self.rd("NotifyPointerMotionRelative", GLib.Variant("(dd)", (x - px, y - py)))
            time.sleep(0.03)
        raise RuntimeError(f"pointer stuck at {self.pointer()}, wanted {x},{y}")

    def button(self, down: bool) -> None:
        self.rd("NotifyPointerButton", GLib.Variant("(ib)", (BTN_LEFT, down)))

    def key(self, code: int, down: bool) -> None:
        self.rd("NotifyKeyboardKeycode", GLib.Variant("(ub)", (code, down)))

    def shot(self, path: str) -> None:
        try:
            call("org.gnome.Shell.Screenshot", "/org/gnome/Shell/Screenshot", "org.gnome.Shell.Screenshot", "Screenshot", GLib.Variant("(bbs)", (False, False, path)), "(bs)", 20000)
        except GLib.Error as e:
            log("screenshot:", e.message)

    def xwayland(self) -> object:
        return self.eval("JSON.stringify(global.get_window_actors().map(a => a.meta_window.get_client_type()))")


class Kwin:
    def __init__(self) -> None:
        self.input = subprocess.Popen([INPUT], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        assert self.input.stdout is not None
        line = self.input.stdout.readline().strip()
        if not line.startswith("ready"):
            raise RuntimeError(f"kwin-input: {line!r}")
        log("kwin fake input", line)
        self.logfile = os.environ["KWIN_LOG"]

    def send(self, line: str) -> None:
        assert self.input.stdin is not None and self.input.stdout is not None
        self.input.stdin.write(line + "\n")
        self.input.stdin.flush()
        got = self.input.stdout.readline().strip()
        if got != "ok":
            raise RuntimeError(f"kwin-input answered {got!r} to {line!r}")

    def script(self, body: str) -> list[str]:
        marker = f"kiwi-{time.monotonic_ns()}"
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(body.replace("MARK", marker))
            path = f.name
        before = os.path.getsize(self.logfile)
        r = call("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "loadScript", GLib.Variant("(ss)", (path, marker)), "(i)")
        assert r is not None
        sid = r.unpack()[0]
        for obj in (f"/Scripting/Script{sid}", f"/{sid}"):
            try:
                call("org.kde.KWin", obj, "org.kde.kwin.Script", "run")
                break
            except GLib.Error as e:
                log(f"script {sid} at {obj}: {e.message}")
        time.sleep(0.8)
        call("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", GLib.Variant("(s)", (marker,)))
        with open(self.logfile, errors="replace") as f:
            f.seek(before)
            text = f.read()
        return [line.split(marker + " ", 1)[1] for line in text.splitlines() if marker + " " in line]

    def layout(self, want: dict[str, list[int]]) -> dict[str, object]:
        self.script(
            "const want = " + json.dumps(want) + ";"
            " for (const w of workspace.windowList()) { const g = want[w.caption]; if (!g) continue;"
            " w.setMaximize(false, false); w.frameGeometry = { x: g[0], y: g[1], width: g[2], height: g[3] }; }"
        )
        time.sleep(1)
        return self.geometry()

    def geometry(self) -> dict[str, object]:
        lines = self.script(
            "for (const w of workspace.windowList()) { const f = w.frameGeometry; const c = w.clientGeometry;"
            ' console.log("MARK " + JSON.stringify([w.caption, { f: [f.x, f.y, f.width, f.height], c: [c.x, c.y, c.width, c.height],'
            " focus: w.active, x11: !!w.x11Client || false }])); }"
        )
        out: dict[str, object] = {}
        for line in lines:
            try:
                title, g = json.loads(line)
                out[title] = g
            except ValueError:
                log("unparsed:", line)
        return out

    def move(self, x: float, y: float) -> None:
        self.send(f"abs {x} {y}")

    def button(self, down: bool) -> None:
        self.send(f"btn {BTN_LEFT} {1 if down else 0}")

    def key(self, code: int, down: bool) -> None:
        self.send(f"key {code} {1 if down else 0}")

    def shot(self, path: str) -> None:
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "shot.py"), "kwin", path], check=False, capture_output=True, text=True)
        if r.returncode:
            log("screenshot:", r.stderr.strip().splitlines()[-1] if r.stderr.strip() else r.returncode)


desk: Gnome | Kwin = Gnome() if KIND == "gnome" else Kwin()


def num(v: object) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    raise ValueError(f"not a number: {v!r}")


def point(v: object) -> tuple[float, float]:
    if isinstance(v, list) and len(v) == 2:
        return num(v[0]), num(v[1])
    raise ValueError(f"not a point: {v!r}")


def handle(req: dict[str, object]) -> object:
    op = req["op"]
    if op == "layout":
        want = req["windows"]
        assert isinstance(want, dict)
        return desk.layout(want)
    if op == "geometry":
        return desk.geometry()
    if op == "click":
        x, y = num(req["x"]), num(req["y"])
        desk.move(x, y)
        time.sleep(0.1)
        desk.button(True)
        time.sleep(0.08)
        desk.button(False)
        return "clicked"
    if op == "hover":
        desk.move(num(req["x"]), num(req["y"]))
        return "hovered"
    if op == "keys":
        combo = req["combo"]
        assert isinstance(combo, list)
        codes = [KEYS[str(k)] for k in combo]
        for c in codes:
            desk.key(c, True)
            time.sleep(0.04)
        for c in reversed(codes):
            desk.key(c, False)
            time.sleep(0.04)
        return "keyed"
    if op == "drag":
        fx, fy = point(req["from"])
        tx, ty = point(req["to"])
        steps = int(num(req.get("steps", 30)))
        desk.move(fx, fy)
        time.sleep(0.2)
        desk.button(True)
        time.sleep(0.2)
        for i in range(1, 6):
            desk.move(fx + i * 3, fy + i * 3)
            time.sleep(0.05)
        for i in range(1, steps + 1):
            desk.move(fx + (tx - fx) * i / steps, fy + (ty - fy) * i / steps)
            time.sleep(0.05)
        time.sleep(0.6)
        desk.move(tx + 2, ty + 2)
        time.sleep(0.4)
        desk.button(False)
        return "dragged"
    if op == "shot":
        desk.shot(str(req["path"]))
        return "shot"
    raise RuntimeError(f"unknown op {op}")


print(json.dumps({"ready": KIND}), flush=True)
for raw in sys.stdin:
    try:
        print(json.dumps({"ok": handle(json.loads(raw))}), flush=True)
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}), flush=True)

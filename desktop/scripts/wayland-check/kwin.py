import json
import os
import subprocess
import sys
import tempfile
import time

from gi.repository import Gio, GLib

INPUT = sys.argv[1]
KEYS = {"ctrl": 29, "a": 30, "c": 46, "v": 47}
BTN_LEFT = 272
conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
fake = subprocess.Popen([INPUT], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
assert fake.stdin is not None and fake.stdout is not None
first = fake.stdout.readline().strip()
if not first.startswith("ready"):
    raise SystemExit(f"kwin-input: {first!r}")
LOG = os.environ["KWIN_LOG"]


def send(line: str) -> None:
    assert fake.stdin is not None and fake.stdout is not None
    fake.stdin.write(line + "\n")
    fake.stdin.flush()
    got = fake.stdout.readline().strip()
    if got != "ok":
        raise RuntimeError(f"kwin-input answered {got!r} to {line!r}")


def call(path: str, iface: str, method: str, args: GLib.Variant | None = None, reply: str | None = None) -> GLib.Variant | None:
    return conn.call_sync("org.kde.KWin", path, iface, method, args, GLib.VariantType(reply) if reply else None, Gio.DBusCallFlags.NONE, 10000, None)


def script(body: str) -> list[str]:
    mark = f"kiwi-{time.monotonic_ns()}"
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(body.replace("MARK", mark))
        path = f.name
    before = os.path.getsize(LOG)
    r = call("/Scripting", "org.kde.kwin.Scripting", "loadScript", GLib.Variant("(ss)", (path, mark)), "(i)")
    assert r is not None
    sid = r.unpack()[0]
    for obj in (f"/Scripting/Script{sid}", f"/{sid}"):
        try:
            call(obj, "org.kde.kwin.Script", "run")
            break
        except GLib.Error:
            continue
    time.sleep(0.8)
    call("/Scripting", "org.kde.kwin.Scripting", "unloadScript", GLib.Variant("(s)", (mark,)))
    os.unlink(path)
    with open(LOG, errors="replace") as f:
        f.seek(before)
        text = f.read()
    return [line.split(mark + " ", 1)[1] for line in text.splitlines() if mark + " " in line]


def geometry() -> dict[str, object]:
    out: dict[str, object] = {}
    for line in script(
        "for (const w of workspace.windowList()) { const c = w.clientGeometry;"
        ' console.log("MARK " + JSON.stringify([w.caption, { c: [c.x, c.y, c.width, c.height], x11: !!w.x11Client }])); }'
    ):
        title, g = json.loads(line)
        out[str(title)] = g
    return out


def layout(want: object) -> dict[str, object]:
    script(
        "const want = " + json.dumps(want) + ";"
        " for (const w of workspace.windowList()) { const g = want[w.caption]; if (!g) continue;"
        " w.setMaximize(false, false); w.frameGeometry = { x: g[0], y: g[1], width: g[2], height: g[3] }; }"
    )
    time.sleep(1)
    return geometry()


def num(v: object) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    raise ValueError(f"not a number: {v!r}")


def point(v: object) -> tuple[float, float]:
    if isinstance(v, list) and len(v) == 2:
        return num(v[0]), num(v[1])
    raise ValueError(f"not a point: {v!r}")


def move(x: float, y: float) -> None:
    send(f"abs {x} {y}")


def button(down: bool) -> None:
    send(f"btn {BTN_LEFT} {1 if down else 0}")


def handle(req: dict[str, object]) -> object:
    op = req["op"]
    if op == "layout":
        return layout(req["windows"])
    if op == "click":
        move(num(req["x"]), num(req["y"]))
        time.sleep(0.1)
        button(True)
        time.sleep(0.08)
        button(False)
        return "clicked"
    if op == "hover":
        move(num(req["x"]), num(req["y"]))
        return "hovered"
    if op == "keys":
        combo = req["combo"]
        if not isinstance(combo, list):
            raise ValueError("keys takes a list")
        codes = [KEYS[str(k)] for k in combo]
        for c in codes:
            send(f"key {c} 1")
            time.sleep(0.04)
        for c in reversed(codes):
            send(f"key {c} 0")
            time.sleep(0.04)
        return "keyed"
    if op == "drag":
        fx, fy = point(req["from"])
        tx, ty = point(req["to"])
        move(fx, fy)
        time.sleep(0.2)
        button(True)
        time.sleep(0.2)
        for i in range(1, 6):
            move(fx + i * 3, fy + i * 3)
            time.sleep(0.05)
        for i in range(1, 31):
            move(fx + (tx - fx) * i / 30, fy + (ty - fy) * i / 30)
            time.sleep(0.05)
        time.sleep(0.6)
        move(tx + 2, ty + 2)
        time.sleep(0.4)
        button(False)
        return "dragged"
    raise ValueError(f"unknown op {op}")


print(json.dumps({"ready": True}), flush=True)
for raw in sys.stdin:
    try:
        print(json.dumps({"ok": handle(json.loads(raw))}), flush=True)
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}), flush=True)

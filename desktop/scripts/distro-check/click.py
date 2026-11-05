import importlib
import subprocess
import sys
import tempfile

from pywayland.client import Display

XML = "/usr/share/plasma-wayland-protocols/fake-input.xml"
BTN_LEFT = 0x110


def main() -> None:
    x, y = float(sys.argv[1]), float(sys.argv[2])
    out = tempfile.mkdtemp()
    subprocess.run([sys.executable, "-m", "pywayland.scanner", "-i", XML, "-o", out], check=True)
    sys.path.insert(0, out)
    fake = importlib.import_module("fake_input").OrgKdeKwinFakeInput
    display = Display()
    display.connect()
    bound: list[object] = []

    def on_global(registry: object, name: int, interface: str, version: int) -> None:
        if interface == "org_kde_kwin_fake_input":
            bound.append(registry.bind(name, fake, min(version, 4)))

    registry = display.get_registry()
    registry.dispatcher["global"] = on_global
    display.roundtrip()
    if not bound:
        print("click: KWin offers no org_kde_kwin_fake_input")
        sys.exit(1)
    device = bound[0]
    device.authenticate("kiwi-raise", "a click in the stand-in browser, as a person clicks a link")
    display.roundtrip()
    device.pointer_motion_absolute(x, y)
    device.button(BTN_LEFT, 1)
    device.button(BTN_LEFT, 0)
    display.roundtrip()
    display.disconnect()
    print(f"click: at {x:.0f},{y:.0f}")


main()

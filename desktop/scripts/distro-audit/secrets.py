import gi

gi.require_version("Secret", "1")
from gi.repository import Secret

try:
    service = Secret.Service.get_sync(Secret.ServiceFlags.LOAD_COLLECTIONS, None)
except Exception as e:
    print(f"no Secret Service: {e}")
    raise SystemExit
for c in service.get_collections() or []:
    c.load_items_sync(None)
    for item in c.get_items() or []:
        attrs = {k: v for k, v in item.get_attributes().items() if k != "xdg:schema"}
        print(f"secret: collection {c.get_label()!r} locked={c.get_locked()} item {item.get_label()!r} {attrs}")
print("secret service: listed")

import sys

import gi

gi.require_version("Gdk", "3.0")
from gi.repository import Gdk

x, y, width, height = (int(v) for v in sys.argv[1:5])
shot = Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), x, y, width, height)
if shot is None:
    print(-1)
    sys.exit(0)
pixels = shot.get_pixels()
channels = shot.get_n_channels()
stride = shot.get_rowstride()
red = 0
for row in range(height):
    start = row * stride
    for col in range(width):
        i = start + col * channels
        r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
        if r > 150 and r > 2 * g and r > 2 * b:
            red += 1
print(red)

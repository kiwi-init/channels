#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <webkit2/webkit2.h>

static GMainLoop *loop;

typedef struct {
  bool (*watch)(void);
  size_t (*take)(void);
  size_t (*bytes)(uint8_t *, size_t);
  bool watching;
  size_t size;
  uint8_t *data;
} Lib;

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void spin(guint ms) {
  g_timeout_add(ms, stop, NULL);
  g_main_loop_run(loop);
}

static gpointer watch_off_main(gpointer data) {
  Lib *lib = data;
  lib->watching = lib->watch();
  g_idle_add(stop, NULL);
  return NULL;
}

static gpointer take_off_main(gpointer data) {
  Lib *lib = data;
  g_free(lib->data);
  lib->data = NULL;
  lib->size = lib->take();
  if (lib->size) {
    lib->data = g_malloc(lib->size);
    if (lib->bytes(lib->data, lib->size) != lib->size) lib->size = 0;
  }
  g_idle_add(stop, NULL);
  return NULL;
}

static void off_main(GThreadFunc fn, Lib *lib) {
  GThread *t = g_thread_new("worker", fn, lib);
  g_main_loop_run(loop);
  g_thread_join(t);
}

static void press(GtkWidget *window, guint keyval, GdkModifierType state) {
  GdkDisplay *display = gdk_display_get_default();
  GdkKeymapKey *keys = NULL;
  gint n = 0;
  gdk_keymap_get_entries_for_keyval(gdk_keymap_get_for_display(display), keyval, &keys, &n);
  GdkEvent *event = gdk_event_new(GDK_KEY_PRESS);
  event->key.window = g_object_ref(gtk_widget_get_window(window));
  event->key.send_event = TRUE;
  event->key.time = GDK_CURRENT_TIME;
  event->key.state = state;
  event->key.keyval = keyval;
  event->key.hardware_keycode = n > 0 ? (guint16)keys[0].keycode : 0;
  event->key.group = n > 0 ? (guint8)keys[0].group : 0;
  gdk_event_set_device(event, gdk_seat_get_keyboard(gdk_display_get_default_seat(display)));
  gtk_main_do_event(event);
  gdk_event_free(event);
  g_free(keys);
  spin(100);
}

static bool png_of(Lib *lib, int width, int height) {
  if (lib->size < 8 || memcmp(lib->data, "\x89PNG\r\n\x1a\n", 8) != 0) return false;
  GdkPixbufLoader *loader = gdk_pixbuf_loader_new_with_type("png", NULL);
  bool ok = gdk_pixbuf_loader_write(loader, lib->data, lib->size, NULL) && gdk_pixbuf_loader_close(loader, NULL);
  GdkPixbuf *got = ok ? gdk_pixbuf_loader_get_pixbuf(loader) : NULL;
  ok = got && gdk_pixbuf_get_width(got) == width && gdk_pixbuf_get_height(got) == height;
  g_object_unref(loader);
  return ok;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-paste-test <libkiwi-shell.so> (under Xvfb)\n");
    return 2;
  }
  gtk_init(&argc, &argv);
  loop = g_main_loop_new(NULL, FALSE);
  void *handle = dlopen(argv[1], RTLD_NOW);
  if (!handle) {
    fprintf(stderr, "kiwi-paste-test: %s\n", dlerror());
    return 1;
  }
  Lib lib = {(bool (*)(void))dlsym(handle, "kiwi_watch_paste"), (size_t (*)(void))dlsym(handle, "kiwi_take_paste"), (size_t (*)(uint8_t *, size_t))dlsym(handle, "kiwi_paste_bytes"), false, 0, NULL};
  if (!lib.watch || !lib.take || !lib.bytes) {
    fprintf(stderr, "kiwi-paste-test: kiwi_watch_paste, kiwi_take_paste or kiwi_paste_bytes isn't exported\n");
    return 1;
  }
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  GtkWidget *view = webkit_web_view_new();
  gtk_container_add(GTK_CONTAINER(window), view);
  gtk_widget_show_all(window);
  webkit_web_view_load_html(WEBKIT_WEB_VIEW(view), "<div contenteditable>here</div>", "http://localhost/");
  gtk_widget_grab_focus(view);
  spin(1000);
  GdkPixbuf *red = gdk_pixbuf_new(GDK_COLORSPACE_RGB, TRUE, 8, 4, 3);
  gdk_pixbuf_fill(red, 0xff0000ff);
  gtk_clipboard_set_image(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), red);
  spin(200);

  off_main(watch_off_main, &lib);
  if (!lib.watching) {
    fprintf(stderr, "kiwi-paste-test: kiwi_watch_paste, asked from another thread, didn't install its hook\n");
    return 1;
  }
  int bad = 0;
  off_main(take_off_main, &lib);
  if (lib.size) {
    fprintf(stderr, "kiwi-paste-test: with no paste key pressed, the clipboard's image was served (%zu bytes)\n", lib.size);
    bad++;
  } else
    printf("no paste key: nothing served, so the page can't read the clipboard on its own\n");

  press(window, GDK_KEY_v, GDK_CONTROL_MASK);
  off_main(take_off_main, &lib);
  if (!png_of(&lib, 4, 3)) {
    fprintf(stderr, "kiwi-paste-test: right after Ctrl+V on the web view, kiwi_take_paste gave %zu bytes, not the clipboard's 4x3 image as a PNG\n", lib.size);
    bad++;
  } else
    printf("Ctrl+V on the web view: the clipboard's 4x3 image, as a %zu-byte PNG\n", lib.size);
  off_main(take_off_main, &lib);
  if (lib.size) {
    fprintf(stderr, "kiwi-paste-test: a second ask after one Ctrl+V was served again (%zu bytes)\n", lib.size);
    bad++;
  } else
    printf("a second ask after the same Ctrl+V: nothing (once per key)\n");

  press(window, GDK_KEY_Insert, GDK_SHIFT_MASK);
  off_main(take_off_main, &lib);
  if (!png_of(&lib, 4, 3)) {
    fprintf(stderr, "kiwi-paste-test: Shift+Insert didn't serve the image (%zu bytes)\n", lib.size);
    bad++;
  } else
    printf("Shift+Insert: served as well\n");

  press(window, GDK_KEY_v, GDK_CONTROL_MASK | GDK_SHIFT_MASK);
  press(window, GDK_KEY_v, 0);
  off_main(take_off_main, &lib);
  if (lib.size) {
    fprintf(stderr, "kiwi-paste-test: Ctrl+Shift+V (paste as text) or a plain v served the image (%zu bytes)\n", lib.size);
    bad++;
  } else
    printf("Ctrl+Shift+V (paste as plain text) and a typed v: nothing\n");

  press(window, GDK_KEY_v, GDK_CONTROL_MASK);
  spin(2500);
  off_main(take_off_main, &lib);
  if (lib.size) {
    fprintf(stderr, "kiwi-paste-test: an ask 2.5 s after Ctrl+V was served (%zu bytes)\n", lib.size);
    bad++;
  } else
    printf("an ask 2.5 s after Ctrl+V: nothing (only right after the key)\n");
  return bad ? 1 : 0;
}

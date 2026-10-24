#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

static GMainLoop *loop;

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void spin(guint ms) {
  g_timeout_add(ms, stop, NULL);
  g_main_loop_run(loop);
}

typedef void (*LookFn)(void *, double, double, uint32_t, uint32_t);

typedef struct {
  LookFn look;
  void *window;
} Ask;

static gpointer look_off_main(gpointer data) {
  Ask *ask = data;
  ask->look(ask->window, 720, 480, 0xf2f2f5, 0x000000);
  g_idle_add(stop, NULL);
  return NULL;
}

static gboolean look_from_worker(gpointer data) {
  g_thread_unref(g_thread_new("worker", look_off_main, data));
  return G_SOURCE_REMOVE;
}

static guint32 background(GtkWidget *window) {
  GdkRGBA *c = NULL;
  gtk_style_context_get(gtk_widget_get_style_context(window), GTK_STATE_FLAG_NORMAL, "background-color", &c, NULL);
  guint32 rgb = c ? ((guint32)(c->red * 255 + 0.5) << 16) | ((guint32)(c->green * 255 + 0.5) << 8) | (guint32)(c->blue * 255 + 0.5) : 0xffffffff;
  gdk_rgba_free(c);
  return rgb;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-look-test <libkiwi-shell.so> (under Xvfb, its screen 1280x720)\n");
    return 2;
  }
  gtk_init(&argc, &argv);
  loop = g_main_loop_new(NULL, FALSE);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-look-test: %s\n", dlerror());
    return 1;
  }
  LookFn look = (LookFn)dlsym(lib, "kiwi_window_look");
  if (!look) {
    fprintf(stderr, "kiwi-look-test: kiwi_window_look isn't exported\n");
    return 1;
  }
  GdkRectangle area;
  gdk_monitor_get_workarea(gdk_display_get_monitor(gdk_display_get_default(), 0), &area);
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_default_size(GTK_WINDOW(window), 1200, 800);
  Ask ask = {look, window};
  g_idle_add(look_from_worker, &ask);
  g_main_loop_run(loop);
  gtk_widget_show_all(window);
  spin(500);
  int bad = 0;
  gint width = 0;
  gint height = 0;
  gtk_window_get_size(GTK_WINDOW(window), &width, &height);
  if (width > area.width * 9 / 10 || height > area.height * 9 / 10 || width < 720 || height < 480) {
    fprintf(stderr, "kiwi-look-test: on a %dx%d screen the 1200x800 window opened at %dx%d, not within 90%% of it and at least 720x480\n", area.width, area.height, width, height);
    bad++;
  } else
    printf("first window: %dx%d on a %dx%d screen (1200x800 asked), within 90%% of it\n", width, height, area.width, area.height);

  gtk_window_resize(GTK_WINDOW(window), 300, 200);
  spin(500);
  gtk_window_get_size(GTK_WINDOW(window), &width, &height);
  if (width < 720 || height < 480) {
    fprintf(stderr, "kiwi-look-test: resized to 300x200, the window went to %dx%d, under its 720x480 minimum\n", width, height);
    bad++;
  } else
    printf("resized to 300x200: stays %dx%d, its minimum\n", width, height);

  guint32 light = background(window);
  g_object_set(gtk_settings_get_default(), "gtk-application-prefer-dark-theme", TRUE, NULL);
  spin(200);
  guint32 dark = background(window);
  if (light != 0xf2f2f5 || dark != 0x000000) {
    fprintf(stderr, "kiwi-look-test: the window's background is #%06x light and #%06x dark, not the page's #f2f2f5 and #000000\n", light, dark);
    bad++;
  } else
    printf("background: #f2f2f5, and #000000 once GTK prefers dark, as the page's (no white edge while a resize catches up)\n");
  return bad ? 1 : 0;
}

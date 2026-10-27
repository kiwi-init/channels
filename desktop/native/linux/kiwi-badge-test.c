#include <dlfcn.h>
#include <gio/gio.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static GMainLoop *loop;
static int updates = 0;
static gchar *app_uri = NULL;
static gint64 count = -1;
static gboolean visible = TRUE;
static gchar *path = NULL;

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void spin(guint ms) {
  g_timeout_add(ms, stop, NULL);
  g_main_loop_run(loop);
}

static void update(GDBusConnection *bus, const gchar *sender, const gchar *object, const gchar *iface, const gchar *signal, GVariant *params, gpointer data) {
  (void)bus;
  (void)sender;
  (void)iface;
  (void)signal;
  (void)data;
  GVariant *props = NULL;
  g_free(app_uri);
  g_free(path);
  g_variant_get(params, "(s@a{sv})", &app_uri, &props);
  path = g_strdup(object);
  if (!g_variant_lookup(props, "count", "x", &count)) count = -1;
  if (!g_variant_lookup(props, "count-visible", "b", &visible)) visible = TRUE;
  g_variant_unref(props);
  updates++;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: kiwi-badge-test /path/to/libkiwi-shell.so\n");
    return 2;
  }
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "dlopen: %s\n", dlerror());
    return 2;
  }
  bool (*badge)(int32_t) = (bool (*)(int32_t))dlsym(lib, "kiwi_badge");
  if (!badge) {
    fprintf(stderr, "libkiwi-shell.so has no kiwi_badge\n");
    return 2;
  }
  loop = g_main_loop_new(NULL, FALSE);
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) {
    fprintf(stderr, "no session bus\n");
    return 2;
  }
  g_dbus_connection_signal_subscribe(bus, NULL, "com.canonical.Unity.LauncherEntry", "Update", NULL, NULL, G_DBUS_SIGNAL_FLAGS_NONE, update, NULL, NULL);
  int failed = 0;

  if (!badge(3)) {
    printf("FAIL kiwi_badge(3) sent nothing\n");
    failed++;
  }
  spin(500);
  if (updates != 1 || g_strcmp0(app_uri, "application://channels-desktop.desktop") != 0 || count != 3 || !visible) {
    printf("FAIL a count of 3 should send one Update for application://channels-desktop.desktop with count 3, shown: got %d, %s, %" G_GINT64_FORMAT ", %s\n", updates, app_uri ? app_uri : "(none)",
           count, visible ? "shown" : "hidden");
    failed++;
  } else {
    printf("ok   a count of 3 sends LauncherEntry Update for application://channels-desktop.desktop at %s, count 3, shown\n", path);
  }

  badge(0);
  spin(500);
  if (updates != 2 || count != 0 || visible) {
    printf("FAIL a count of 0 should hide the badge: got %d updates, count %" G_GINT64_FORMAT ", %s\n", updates, count, visible ? "shown" : "hidden");
    failed++;
  } else {
    printf("ok   a count of 0 hides the badge\n");
  }

  badge(-4);
  spin(500);
  if (updates != 3 || count != 0 || visible) {
    printf("FAIL a negative count should send 0, hidden: got count %" G_GINT64_FORMAT ", %s\n", count, visible ? "shown" : "hidden");
    failed++;
  } else {
    printf("ok   a negative count is sent as 0, hidden\n");
  }
  return failed ? 1 : 0;
}

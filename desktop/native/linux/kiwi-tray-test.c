#include <dlfcn.h>
#include <gio/gio.h>
#include <stdbool.h>
#include <stdio.h>

#define WATCHER "org.kde.StatusNotifierWatcher"

static GMainLoop *loop;
static gboolean host_registered = FALSE;
static bool owned = false;

static const char *WATCHER_XML = "<node><interface name='org.kde.StatusNotifierWatcher'>"
                                 "<property name='IsStatusNotifierHostRegistered' type='b' access='read'/>"
                                 "</interface></node>";

static GVariant *watcher_property(GDBusConnection *c, const gchar *sender, const gchar *path, const gchar *iface, const gchar *name, GError **error, gpointer data) {
  (void)c;
  (void)sender;
  (void)path;
  (void)iface;
  (void)name;
  (void)error;
  (void)data;
  return g_variant_new_boolean(host_registered);
}

static const GDBusInterfaceVTable WATCHER_VTABLE = {NULL, watcher_property, NULL, {0}};

static void acquired(GDBusConnection *c, const gchar *name, gpointer data) {
  (void)c;
  (void)name;
  (void)data;
  owned = true;
  g_main_loop_quit(loop);
}

typedef struct {
  bool (*tray_host)(void);
  bool host;
} Ask;

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static gpointer ask_off_main(gpointer data) {
  Ask *ask = data;
  ask->host = ask->tray_host();
  g_idle_add(stop, NULL);
  return NULL;
}

static bool ask(bool (*tray_host)(void)) {
  Ask a = {tray_host, false};
  GThread *worker = g_thread_new("worker", ask_off_main, &a);
  g_main_loop_run(loop);
  g_thread_join(worker);
  return a.host;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-tray-test <libkiwi-shell.so> (on a private session bus: dbus-run-session)\n");
    return 2;
  }
  loop = g_main_loop_new(NULL, FALSE);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-tray-test: %s\n", dlerror());
    return 1;
  }
  bool (*tray_host)(void) = (bool (*)(void))dlsym(lib, "kiwi_tray_host");
  if (!tray_host) {
    fprintf(stderr, "kiwi-tray-test: kiwi_tray_host isn't exported\n");
    return 1;
  }
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) {
    fprintf(stderr, "kiwi-tray-test: no session bus; run it under dbus-run-session\n");
    return 1;
  }
  int bad = 0;
  if (ask(tray_host)) {
    fprintf(stderr, "kiwi-tray-test: with no StatusNotifierWatcher on the bus, kiwi_tray_host said a tray host runs\n");
    bad++;
  } else
    printf("no StatusNotifierWatcher (vanilla GNOME, a bare compositor): no tray host, so closing minimizes\n");

  GDBusNodeInfo *node = g_dbus_node_info_new_for_xml(WATCHER_XML, NULL);
  g_dbus_connection_register_object(bus, "/StatusNotifierWatcher", node->interfaces[0], &WATCHER_VTABLE, NULL, NULL, NULL);
  g_bus_own_name_on_connection(bus, WATCHER, G_BUS_NAME_OWNER_FLAGS_NONE, acquired, NULL, NULL, NULL);
  if (!owned) g_main_loop_run(loop);
  if (ask(tray_host)) {
    fprintf(stderr, "kiwi-tray-test: a watcher with no host registered counted as a tray host\n");
    bad++;
  } else
    printf("a StatusNotifierWatcher with no host registered: no tray host either\n");

  host_registered = TRUE;
  if (!ask(tray_host)) {
    fprintf(stderr, "kiwi-tray-test: a watcher with a host registered didn't count as a tray host\n");
    bad++;
  } else
    printf("a StatusNotifierWatcher with a host registered (Plasma, GNOME's AppIndicator extension): a tray host, so closing hides to it\n");
  return bad ? 1 : 0;
}

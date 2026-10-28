#include <dlfcn.h>
#include <gio/gio.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#define WATCHER "org.kde.StatusNotifierWatcher"
#define ITEM "org.kde.StatusNotifierItem"

static GMainLoop *loop;
static gboolean host_registered = FALSE;
static bool owned = false;
static bool registered = false;
static char icon_name[256];
static char title[256];
static int bad = 0;

static const char *WATCHER_XML = "<node><interface name='org.kde.StatusNotifierWatcher'>"
                                 "<method name='RegisterStatusNotifierItem'><arg name='service' type='s' direction='in'/></method>"
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

static void copy_property(GVariant *properties, const char *name, char *out, size_t size) {
  GVariant *value = g_variant_lookup_value(properties, name, G_VARIANT_TYPE_STRING);
  if (!value) {
    fprintf(stderr, "kiwi-tray-test: the tray item has no %s string\n", name);
    bad++;
    return;
  }
  const char *text = NULL;
  g_variant_get(value, "&s", &text);
  snprintf(out, size, "%s", text);
  g_variant_unref(value);
}

static void item_properties(GObject *source, GAsyncResult *result, gpointer data) {
  (void)data;
  GError *error = NULL;
  GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
  if (!reply) {
    fprintf(stderr, "kiwi-tray-test: couldn't read the tray item: %s\n", error->message);
    g_error_free(error);
    bad++;
  } else {
    GVariant *properties = NULL;
    g_variant_get(reply, "(@a{sv})", &properties);
    copy_property(properties, "IconName", icon_name, sizeof(icon_name));
    copy_property(properties, "Title", title, sizeof(title));
    g_variant_unref(properties);
    g_variant_unref(reply);
  }
  registered = true;
  g_main_loop_quit(loop);
}

static void item_registered(GDBusConnection *c, const gchar *sender, const gchar *path, const gchar *iface, const gchar *method, GVariant *parameters, GDBusMethodInvocation *invocation, gpointer data) {
  (void)path;
  (void)iface;
  (void)method;
  (void)data;
  const gchar *service = NULL;
  g_variant_get(parameters, "(&s)", &service);
  const gchar *item_path = service[0] == '/' ? service : "/StatusNotifierItem";
  const gchar *item_service = service[0] == '/' ? sender : service;
  g_dbus_method_invocation_return_value(invocation, NULL);
  g_dbus_connection_call(c, item_service, item_path, "org.freedesktop.DBus.Properties", "GetAll", g_variant_new("(s)", ITEM), NULL, G_DBUS_CALL_FLAGS_NONE, 5000, NULL, item_properties, NULL);
}

static const GDBusInterfaceVTable WATCHER_VTABLE = {item_registered, watcher_property, NULL, {0}};

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

static void stop_app(GPid app) {
  kill(-app, SIGTERM);
  int status = 0;
  for (int i = 0; i < 50; i++) {
    waitpid(app, &status, WNOHANG);
    if (kill(-app, 0) != 0) {
      g_spawn_close_pid(app);
      return;
    }
    g_usleep(100000);
  }
  kill(-app, SIGKILL);
  waitpid(app, &status, 0);
  g_spawn_close_pid(app);
}

int main(int argc, char **argv) {
  bool no_indicator = argc == 3 && strcmp(argv[2], "no-indicator") == 0;
  if (argc != 3) {
    fprintf(stderr, "usage: kiwi-tray-test <libkiwi-shell.so> <launcher|no-indicator> (on a private session bus: dbus-run-session)\n");
    return 2;
  }
  loop = g_main_loop_new(NULL, FALSE);
  void *shell = dlopen(argv[1], RTLD_NOW);
  if (!shell) {
    fprintf(stderr, "kiwi-tray-test: %s\n", dlerror());
    return 1;
  }
  bool (*tray_host)(void) = (bool (*)(void))dlsym(shell, "kiwi_tray_host");
  if (!tray_host) {
    fprintf(stderr, "kiwi-tray-test: kiwi_tray_host isn't exported\n");
    return 1;
  }
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) {
    fprintf(stderr, "kiwi-tray-test: no session bus; run it under dbus-run-session\n");
    return 1;
  }
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
    fprintf(stderr, "kiwi-tray-test: a watcher with a host registered didn't count as a tray host%s\n", no_indicator ? " (with no libayatana-appindicator3: the tray is Electrobun's own StatusNotifierItem, which needs none)" : "");
    bad++;
  } else
    printf("a StatusNotifierWatcher with a host registered (Plasma, GNOME's AppIndicator extension)%s: a tray host, so closing hides to it\n", no_indicator ? ", with no libayatana-appindicator3 (stock Fedora, Arch)" : "");
  if (!no_indicator) {
    gchar *command[] = {"setsid", argv[2], NULL};
    GPid app = 0;
    GError *error = NULL;
    if (!g_spawn_async(NULL, command, NULL, G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD, NULL, NULL, &app, &error)) {
      fprintf(stderr, "kiwi-tray-test: couldn't start the app: %s\n", error->message);
      g_error_free(error);
      bad++;
    } else {
      if (!registered) {
        g_timeout_add_seconds(30, stop, NULL);
        g_main_loop_run(loop);
      }
      if (!registered) {
        fprintf(stderr, "kiwi-tray-test: the tray item didn't register\n");
        bad++;
      } else {
        if (strcmp(icon_name, "channels-tray-symbolic") != 0) {
          fprintf(stderr, "kiwi-tray-test: IconName is %s, not channels-tray-symbolic\n", icon_name);
          bad++;
        }
        if (strcmp(title, "Channels") != 0) {
          fprintf(stderr, "kiwi-tray-test: Title is %s, not Channels\n", title);
          bad++;
        }
        if (!bad) printf("tray item: IconName=%s, Title=%s\n", icon_name, title);
      }
      stop_app(app);
    }
  }
  return bad ? 1 : 0;
}

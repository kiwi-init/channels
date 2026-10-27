#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#define NOTES "org.freedesktop.Notifications"
#define NOTES_PATH "/org/freedesktop/Notifications"

static GMainLoop *loop;
static GDBusConnection *bus;
static bool owned = false;
static int clicked = 0;
static int shown = 0;
static gchar *app_name = NULL;
static gchar *app_icon = NULL;
static gchar *summary = NULL;
static gchar *body = NULL;
static gchar *entry = NULL;
static bool has_default = false;

static const char *NOTES_XML = "<node><interface name='org.freedesktop.Notifications'>"
                               "<method name='GetCapabilities'><arg type='as' direction='out'/></method>"
                               "<method name='Notify'><arg type='s' direction='in'/><arg type='u' direction='in'/><arg type='s' direction='in'/><arg type='s' direction='in'/>"
                               "<arg type='s' direction='in'/><arg type='as' direction='in'/><arg type='a{sv}' direction='in'/><arg type='i' direction='in'/><arg type='u' direction='out'/></method>"
                               "<signal name='ActionInvoked'><arg type='u'/><arg type='s'/></signal>"
                               "<signal name='ActivationToken'><arg type='u'/><arg type='s'/></signal>"
                               "<signal name='NotificationClosed'><arg type='u'/><arg type='u'/></signal>"
                               "</interface></node>";

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void spin(guint ms) {
  g_timeout_add(ms, stop, NULL);
  g_main_loop_run(loop);
}

static void notes_call(GDBusConnection *c, const gchar *sender, const gchar *path, const gchar *iface, const gchar *method, GVariant *params, GDBusMethodInvocation *call, gpointer data) {
  (void)c;
  (void)sender;
  (void)path;
  (void)iface;
  (void)data;
  if (strcmp(method, "GetCapabilities") == 0) {
    const gchar *caps[] = {"actions", "body", "body-markup", NULL};
    g_dbus_method_invocation_return_value(call, g_variant_new("(^as)", caps));
    return;
  }
  GVariantIter *actions = NULL;
  GVariant *hints = NULL;
  guint32 replaces = 0;
  gint32 timeout = 0;
  g_free(app_name);
  g_free(app_icon);
  g_free(summary);
  g_free(body);
  g_variant_get(params, "(susssas@a{sv}i)", &app_name, &replaces, &app_icon, &summary, &body, &actions, &hints, &timeout);
  const gchar *action = NULL;
  int i = 0;
  while (g_variant_iter_next(actions, "&s", &action))
    if (i++ % 2 == 0 && strcmp(action, "default") == 0) has_default = true;
  g_variant_iter_free(actions);
  g_free(entry);
  entry = NULL;
  g_variant_lookup(hints, "desktop-entry", "s", &entry);
  g_variant_unref(hints);
  shown++;
  g_dbus_method_invocation_return_value(call, g_variant_new("(u)", 7));
}

static const GDBusInterfaceVTable NOTES_VTABLE = {notes_call, NULL, NULL, {0}};

static void acquired(GDBusConnection *c, const gchar *name, gpointer data) {
  (void)c;
  (void)name;
  (void)data;
  owned = true;
  g_main_loop_quit(loop);
}

static void emit(const char *signal, GVariant *params) {
  g_dbus_connection_emit_signal(bus, NULL, NOTES_PATH, NOTES, signal, params, NULL);
  g_dbus_connection_flush_sync(bus, NULL, NULL);
  spin(300);
}

static void on_click(void) { clicked++; }

typedef struct {
  bool (*clicks)(void *, void (*)(void));
  bool (*notify)(const char *, const char *);
  void *window;
  bool ok;
} Calls;

static gpointer calls_off_main(gpointer data) {
  Calls *calls = data;
  calls->ok = calls->clicks(calls->window, on_click) && calls->notify("Ana asks to join kiwi-dev", "Ana & Bo <want in>");
  g_idle_add(stop, NULL);
  return NULL;
}

static gboolean calls_from_worker(gpointer data) {
  g_thread_unref(g_thread_new("worker", calls_off_main, data));
  return G_SOURCE_REMOVE;
}

static gchar *startup_property(GtkWidget *window) {
  GdkAtom type;
  gint format = 0;
  gint length = 0;
  guchar *data = NULL;
  if (!gdk_property_get(gtk_widget_get_window(window), gdk_atom_intern_static_string("_NET_STARTUP_ID"), gdk_atom_intern_static_string("UTF8_STRING"), 0, 1024, FALSE, &type, &format, &length, &data))
    return NULL;
  gchar *value = g_strndup((const gchar *)data, (gsize)length);
  g_free(data);
  return value;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-notify-test <libkiwi-shell.so> (under dbus-run-session and Xvfb)\n");
    return 2;
  }
  gtk_init(&argc, &argv);
  loop = g_main_loop_new(NULL, FALSE);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-notify-test: %s\n", dlerror());
    return 1;
  }
  bool (*clicks)(void *, void (*)(void)) = (bool (*)(void *, void (*)(void)))dlsym(lib, "kiwi_notify_clicks");
  bool (*notify)(const char *, const char *) = (bool (*)(const char *, const char *))dlsym(lib, "kiwi_notify");
  if (!clicks || !notify) {
    fprintf(stderr, "kiwi-notify-test: kiwi_notify or kiwi_notify_clicks isn't exported\n");
    return 1;
  }
  bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) {
    fprintf(stderr, "kiwi-notify-test: no session bus; run it under dbus-run-session\n");
    return 1;
  }
  GDBusNodeInfo *node = g_dbus_node_info_new_for_xml(NOTES_XML, NULL);
  g_dbus_connection_register_object(bus, NOTES_PATH, node->interfaces[0], &NOTES_VTABLE, NULL, NULL, NULL);
  g_bus_own_name_on_connection(bus, NOTES, G_BUS_NAME_OWNER_FLAGS_NONE, acquired, NULL, NULL, NULL);
  if (!owned) g_main_loop_run(loop);

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_widget_show_all(window);
  spin(300);
  gtk_widget_hide(window);
  spin(300);

  Calls calls = {clicks, notify, window, false};
  g_idle_add(calls_from_worker, &calls);
  g_main_loop_run(loop);
  for (int i = 0; i < 30 && !shown; i++) spin(100);
  int bad = 0;
  if (!calls.ok || shown != 1 || g_strcmp0(app_name, "Channels Livewire") != 0 || g_strcmp0(app_icon, "channels-livewire") != 0 || g_strcmp0(entry, "channels-livewire") != 0 || !has_default ||
      g_strcmp0(summary, "Ana asks to join kiwi-dev") != 0 || g_strcmp0(body, "Ana &amp; Bo &lt;want in&gt;") != 0) {
    fprintf(stderr, "kiwi-notify-test: %s; the server got %d notifications: app '%s', icon '%s', desktop-entry '%s', %s default action, summary '%s', body '%s'\n",
            calls.ok ? "sent" : "kiwi_notify or kiwi_notify_clicks refused", shown, app_name, app_icon, entry, has_default ? "a" : "no", summary, body);
    bad++;
  } else
    printf("notification: from Channels Livewire (icon and desktop-entry channels-livewire), with a default action, its body escaped for a server that reads markup\n");

  emit("ActivationToken", g_variant_new("(us)", 99, "someone-else"));
  emit("ActionInvoked", g_variant_new("(us)", 99, "default"));
  emit("ActionInvoked", g_variant_new("(us)", 7, "other"));
  if (clicked) {
    fprintf(stderr, "kiwi-notify-test: another app's notification, or another action, counted as a click on ours (%d)\n", clicked);
    bad++;
  } else
    printf("another app's notification clicked, or another action of ours: ignored\n");

  emit("ActivationToken", g_variant_new("(us)", 7, "kiwi-note-token_TIME7"));
  emit("ActionInvoked", g_variant_new("(us)", 7, "default"));
  gtk_widget_show_all(window);
  spin(500);
  gchar *got = startup_property(window);
  if (clicked != 1 || g_strcmp0(got, "kiwi-note-token_TIME7") != 0) {
    fprintf(stderr, "kiwi-notify-test: clicking ours reached the callback %d times and the window shown again carries _NET_STARTUP_ID '%s', not the notification's token\n", clicked, got ? got : "unset");
    bad++;
  } else
    printf("ours clicked: the callback ran once and the window, shown again, carries the notification's activation token (%s)\n", got);
  g_free(got);

  emit("NotificationClosed", g_variant_new("(uu)", 7, 2));
  emit("ActionInvoked", g_variant_new("(us)", 7, "default"));
  if (clicked != 1) {
    fprintf(stderr, "kiwi-notify-test: a click after the notification closed counted (%d)\n", clicked);
    bad++;
  } else
    printf("closed: later signals for its id are ignored\n");
  return bad ? 1 : 0;
}

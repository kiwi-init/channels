#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <webkit2/webkit2.h>

#define PORTAL "org.freedesktop.portal.Desktop"
#define PORTAL_PATH "/org/freedesktop/portal/desktop"

static GMainLoop *loop;
static GDBusConnection *bus;
static guint32 scheme = 1;
static int reads = 0;
static bool owned = false;
static gchar *seen = NULL;

static const char *SETTINGS_XML = "<node><interface name='org.freedesktop.portal.Settings'>"
                                  "<method name='ReadOne'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='v' direction='out'/></method>"
                                  "<signal name='SettingChanged'><arg type='s'/><arg type='s'/><arg type='v'/></signal>"
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

static void portal_call(GDBusConnection *c, const gchar *sender, const gchar *path, const gchar *iface, const gchar *method, GVariant *params, GDBusMethodInvocation *call, gpointer data) {
  (void)c;
  (void)sender;
  (void)path;
  (void)iface;
  (void)method;
  (void)data;
  const gchar *ns = NULL;
  const gchar *key = NULL;
  g_variant_get(params, "(&s&s)", &ns, &key);
  if (strcmp(ns, "org.freedesktop.appearance") != 0 || strcmp(key, "color-scheme") != 0) {
    g_dbus_method_invocation_return_dbus_error(call, "org.freedesktop.portal.Error.NotFound", "no such setting");
    return;
  }
  reads++;
  g_dbus_method_invocation_return_value(call, g_variant_new("(v)", g_variant_new_uint32(scheme)));
}

static const GDBusInterfaceVTable PORTAL_VTABLE = {portal_call, NULL, NULL, {0}};

static void acquired(GDBusConnection *c, const gchar *name, gpointer data) {
  (void)c;
  (void)name;
  (void)data;
  owned = true;
  g_main_loop_quit(loop);
}

static void change(const char *ns, guint32 value) {
  scheme = value;
  g_dbus_connection_emit_signal(bus, NULL, PORTAL_PATH, "org.freedesktop.portal.Settings", "SettingChanged", g_variant_new("(ssv)", ns, "color-scheme", g_variant_new_uint32(value)), NULL);
  g_dbus_connection_flush_sync(bus, NULL, NULL);
}

static gboolean prefers_dark(void) {
  gboolean dark = FALSE;
  g_object_get(gtk_settings_get_default(), "gtk-application-prefer-dark-theme", &dark, NULL);
  return dark;
}

static void titled(GObject *view, GParamSpec *spec, gpointer data) {
  (void)spec;
  (void)data;
  const char *title = webkit_web_view_get_title(WEBKIT_WEB_VIEW(view));
  if (!title || !*title) return;
  g_free(seen);
  seen = g_strdup(title);
  g_main_loop_quit(loop);
}

static const char *PAGE = "<script>const m = matchMedia('(prefers-color-scheme: dark)');"
                          "const show = () => { document.title = m.matches ? 'dark' : 'light'; };"
                          "show(); m.addEventListener('change', show);</script>";

typedef struct {
  bool (*follow)(void);
  bool ok;
} Follow;

static gpointer follow_off_main(gpointer data) {
  Follow *f = data;
  f->ok = f->follow();
  g_idle_add(stop, NULL);
  return NULL;
}

static gboolean follow_from_worker(gpointer data) {
  g_thread_unref(g_thread_new("worker", follow_off_main, data));
  return G_SOURCE_REMOVE;
}

static bool page_says(WebKitWebView *view, const char *want) {
  for (int i = 0; i < 50 && g_strcmp0(seen, want) != 0; i++) spin(100);
  (void)view;
  return g_strcmp0(seen, want) == 0;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-scheme-test <libkiwi-shell.so> (on a private session bus: dbus-run-session)\n");
    return 2;
  }
  gtk_init(&argc, &argv);
  loop = g_main_loop_new(NULL, FALSE);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-scheme-test: %s\n", dlerror());
    return 1;
  }
  bool (*follow)(void) = (bool (*)(void))dlsym(lib, "kiwi_follow_color_scheme");
  if (!follow) {
    fprintf(stderr, "kiwi-scheme-test: kiwi_follow_color_scheme isn't exported\n");
    return 1;
  }
  bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) {
    fprintf(stderr, "kiwi-scheme-test: no session bus; run it under dbus-run-session\n");
    return 1;
  }
  GDBusNodeInfo *node = g_dbus_node_info_new_for_xml(SETTINGS_XML, NULL);
  g_dbus_connection_register_object(bus, PORTAL_PATH, node->interfaces[0], &PORTAL_VTABLE, NULL, NULL, NULL);
  g_bus_own_name_on_connection(bus, PORTAL, G_BUS_NAME_OWNER_FLAGS_NONE, acquired, NULL, NULL, NULL);
  if (!owned) g_main_loop_run(loop);
  int bad = 0;
  if (prefers_dark()) {
    fprintf(stderr, "kiwi-scheme-test: GTK already prefers dark before anything was read\n");
    return 1;
  }

  Follow f = {follow, false};
  g_idle_add(follow_from_worker, &f);
  g_main_loop_run(loop);
  for (int i = 0; i < 30 && !prefers_dark(); i++) spin(100);
  if (!f.ok || reads != 1 || !prefers_dark()) {
    fprintf(stderr, "kiwi-scheme-test: with the portal's color-scheme at 1 (dark), following it %s, read it %d times, and GTK %s dark\n", f.ok ? "started" : "didn't start", reads, prefers_dark() ? "prefers" : "doesn't prefer");
    bad++;
  } else
    printf("portal color-scheme 1 (GNOME's Dark style): read once, asked from another thread, and GTK prefers dark\n");

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
  g_signal_connect(view, "notify::title", G_CALLBACK(titled), NULL);
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
  gtk_widget_show_all(window);
  webkit_web_view_load_html(view, PAGE, "http://localhost/");
  if (!page_says(view, "dark")) {
    fprintf(stderr, "kiwi-scheme-test: the page's prefers-color-scheme came out '%s', not dark\n", seen ? seen : "nothing in 5s");
    bad++;
  } else
    printf("page: prefers-color-scheme is dark\n");

  change("org.gnome.desktop.interface", 2);
  spin(500);
  if (!prefers_dark()) {
    fprintf(stderr, "kiwi-scheme-test: a color-scheme change in another namespace turned GTK's dark preference off\n");
    bad++;
  } else
    printf("a change outside org.freedesktop.appearance: ignored\n");

  change("org.freedesktop.appearance", 2);
  if (!page_says(view, "light") || prefers_dark()) {
    fprintf(stderr, "kiwi-scheme-test: after the portal said 2 (light), GTK %s dark and the page says '%s'\n", prefers_dark() ? "still prefers" : "doesn't prefer", seen ? seen : "nothing");
    bad++;
  } else
    printf("portal color-scheme 2 (light), while the app runs: GTK and the open page follow, no reload\n");

  change("org.freedesktop.appearance", 1);
  if (!page_says(view, "dark") || !prefers_dark()) {
    fprintf(stderr, "kiwi-scheme-test: back to 1 (dark), GTK %s dark and the page says '%s'\n", prefers_dark() ? "prefers" : "doesn't prefer", seen ? seen : "nothing");
    bad++;
  } else
    printf("back to 1 (dark): the page follows again\n");

  change("org.freedesktop.appearance", 0);
  if (!page_says(view, "light") || prefers_dark()) {
    fprintf(stderr, "kiwi-scheme-test: at 0 (no preference) GTK %s dark (it didn't before) and the page says '%s'\n", prefers_dark() ? "prefers" : "doesn't prefer", seen ? seen : "nothing");
    bad++;
  } else
    printf("0 (no preference): back to GTK's own setting from before (light here)\n");
  return bad ? 1 : 0;
}

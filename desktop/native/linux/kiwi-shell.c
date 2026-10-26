#include <dlfcn.h>
#include <gdk/gdk.h>
#include <glib-object.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#define KIWI_APP_ID "channels-livewire"
#define NOTES "org.freedesktop.Notifications"
#define NOTES_PATH "/org/freedesktop/Notifications"
#define TRAY_WATCHER "org.kde.StatusNotifierWatcher"
#define TRAY_LIBRARY "libayatana-appindicator3.so.1"
#define PORTAL "org.freedesktop.portal.Desktop"
#define PORTAL_PATH "/org/freedesktop/portal/desktop"
#define PORTAL_SETTINGS "org.freedesktop.portal.Settings"
#define APPEARANCE "org.freedesktop.appearance"
#define COLOR_SCHEME "color-scheme"

static void (*page_gone)(void) = NULL;
static gchar *the_page = NULL;
static GMutex committed_lock;
static char committed[4096] = "";
static GMutex drop_lock;
static gchar **dropped = NULL;
static gint64 dropped_at = 0;
static gint64 drop_landed = 0;
static GMutex paste_lock;
static gint64 paste_key_at = 0;
static GBytes *pasted = NULL;

__attribute__((constructor)) static void kiwi_identity(void) {
  g_set_prgname(KIWI_APP_ID);
  gdk_set_program_class(KIWI_APP_ID);
}

static gboolean deny_request(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)data;
  if (n < 2) return TRUE;
  GObject *view = g_value_get_object(&params[0]);
  GObject *request = g_value_get_object(&params[1]);
  if (view) g_signal_handlers_block_matched(view, G_SIGNAL_MATCH_ID, hint->signal_id, 0, NULL, NULL, NULL);
  if (request && WEBKIT_IS_PERMISSION_REQUEST(request)) webkit_permission_request_deny(WEBKIT_PERMISSION_REQUEST(request));
  return TRUE;
}

static gboolean process_ended(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)n;
  (void)params;
  (void)data;
  if (page_gone) page_gone();
  return TRUE;
}

static gboolean load_changed(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 2 || g_value_get_enum(&params[1]) != WEBKIT_LOAD_COMMITTED) return TRUE;
  GObject *view = g_value_get_object(&params[0]);
  const char *uri = view ? webkit_web_view_get_uri(WEBKIT_WEB_VIEW(view)) : NULL;
  g_mutex_lock(&committed_lock);
  if (g_strlcpy(committed, uri ? uri : "", sizeof committed) >= sizeof committed) committed[0] = 0;
  g_mutex_unlock(&committed_lock);
  return TRUE;
}

static bool own_download(const char *uri) {
  return uri && (g_ascii_strncasecmp(uri, "blob:", 5) == 0 || g_ascii_strncasecmp(uri, "data:", 5) == 0);
}

static bool is_the_page(const char *uri) {
  size_t n = the_page ? strlen(the_page) : 0;
  if (n == 0 || !uri || strncmp(uri, the_page, n) != 0) return false;
  return uri[n] == 0 || uri[n] == '#';
}

static gboolean only_the_page(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 3) return TRUE;
  GObject *decision = g_value_get_object(&params[1]);
  WebKitPolicyDecisionType type = g_value_get_enum(&params[2]);
  if (!decision || (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION && type != WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION)) return TRUE;
  WebKitPolicyDecision *policy = WEBKIT_POLICY_DECISION(decision);
  if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
    webkit_policy_decision_ignore(policy);
    return TRUE;
  }
  WebKitNavigationAction *action = webkit_navigation_policy_decision_get_navigation_action(WEBKIT_NAVIGATION_POLICY_DECISION(decision));
  const char *uri = action ? webkit_uri_request_get_uri(webkit_navigation_action_get_request(action)) : NULL;
  if (is_the_page(uri)) return TRUE;
  if (own_download(uri))
    webkit_policy_decision_download(policy);
  else
    webkit_policy_decision_ignore(policy);
  return TRUE;
}

static gboolean download_started(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 2) return TRUE;
  GObject *download = g_value_get_object(&params[1]);
  if (download && !own_download(webkit_uri_request_get_uri(webkit_download_get_request(WEBKIT_DOWNLOAD(download))))) webkit_download_cancel(WEBKIT_DOWNLOAD(download));
  return TRUE;
}

static gboolean decide_destination(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 1) return TRUE;
  GObject *download = g_value_get_object(&params[0]);
  if (download && !own_download(webkit_uri_request_get_uri(webkit_download_get_request(WEBKIT_DOWNLOAD(download))))) webkit_download_cancel(WEBKIT_DOWNLOAD(download));
  return TRUE;
}

typedef struct {
  bool (*run)(gconstpointer arg);
  gconstpointer arg;
  GMutex lock;
  GCond cond;
  bool done;
  bool ok;
} OnMain;

static gboolean run_on_main(gpointer data) {
  OnMain *call = data;
  bool ok = call->run(call->arg);
  g_mutex_lock(&call->lock);
  call->ok = ok;
  call->done = true;
  g_cond_signal(&call->cond);
  g_mutex_unlock(&call->lock);
  return G_SOURCE_REMOVE;
}

static bool on_main(bool (*run)(gconstpointer), gconstpointer arg) {
  GMainContext *main = g_main_context_default();
  if (g_main_context_is_owner(main)) return run(arg);
  OnMain *call = g_new0(OnMain, 1);
  call->run = run;
  call->arg = arg;
  g_mutex_init(&call->lock);
  g_cond_init(&call->cond);
  GSource *source = g_idle_source_new();
  g_source_set_callback(source, run_on_main, call, NULL);
  g_source_attach(source, main);
  g_source_unref(source);
  gint64 until = g_get_monotonic_time() + 10 * G_TIME_SPAN_SECOND;
  g_mutex_lock(&call->lock);
  while (!call->done && g_cond_wait_until(&call->cond, &call->lock, until)) {
  }
  bool done = call->done;
  bool ok = call->ok;
  g_mutex_unlock(&call->lock);
  if (done) {
    g_mutex_clear(&call->lock);
    g_cond_clear(&call->cond);
    g_free(call);
  }
  return done && ok;
}

typedef struct {
  GType (*type)(void);
  const char *signal;
  GSignalEmissionHook fn;
} Hook;

static bool install_hook(gconstpointer arg) {
  const Hook *hook = arg;
  GType type = hook->type();
  g_type_class_ref(type);
  guint id = g_signal_lookup(hook->signal, type);
  return id != 0 && g_signal_add_emission_hook(id, 0, hook->fn, NULL, NULL) != 0;
}

static bool has_program(const char *name) {
  gchar *found = g_find_program_in_path(name);
  bool has = found != NULL;
  g_free(found);
  return has;
}

static bool userns_restricted(void) {
  gchar *value = NULL;
  bool restricted = g_file_get_contents("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", &value, NULL, NULL) && g_strstrip(value)[0] == '1';
  g_free(value);
  return restricted;
}

static gchar *bwrap_refusal(void) {
  gchar *argv[] = {"bwrap", "--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "true", NULL};
  gchar *err = NULL;
  gint status = 0;
  GError *error = NULL;
  gchar *refusal = NULL;
  if (!g_spawn_sync(NULL, argv, NULL, G_SPAWN_SEARCH_PATH | G_SPAWN_STDOUT_TO_DEV_NULL, NULL, NULL, NULL, &err, &status, &error)) {
    refusal = g_strdup_printf("bwrap didn't run (%s)", error->message);
    g_error_free(error);
  } else if (!g_spawn_check_wait_status(status, NULL)) {
    gchar **lines = g_strsplit(g_strstrip(err), "\n", 2);
    refusal = g_strdup_printf("bwrap can't build it here (%s)%s", lines[0] && *lines[0] ? lines[0] : "no message",
                              userns_restricted() ? "; AppArmor restricts unprivileged user namespaces on this system" : "");
    g_strfreev(lines);
  }
  g_free(err);
  return refusal;
}

static gchar *started_webkit(void) {
  gchar *found = NULL;
  long self = (long)getpid();
  GDir *dir = g_dir_open("/proc", 0, NULL);
  if (!dir) return NULL;
  const gchar *name;
  while (!found && (name = g_dir_read_name(dir))) {
    char *end;
    long pid = strtol(name, &end, 10);
    if (*end) continue;
    gchar *path = g_strdup_printf("/proc/%ld/stat", pid);
    gchar *text = NULL;
    if (g_file_get_contents(path, &text, NULL, NULL)) {
      char *lp = strchr(text, '(');
      char *rp = strrchr(text, ')');
      long ppid = 0;
      if (lp && rp && rp > lp && sscanf(rp + 2, "%*c %ld", &ppid) == 1 && ppid == self && g_str_has_prefix(lp + 1, "WebKit")) found = g_strndup(lp + 1, (gsize)(rp - lp - 1));
    }
    g_free(text);
    g_free(path);
  }
  g_dir_close(dir);
  return found;
}

static void (*context_constructed)(GObject *) = NULL;

static void sandboxed_constructed(GObject *object) {
  if (context_constructed) context_constructed(object);
  webkit_web_context_set_sandbox_enabled(WEBKIT_WEB_CONTEXT(object), TRUE);
}

static bool sandbox_contexts(gconstpointer arg) {
  (void)arg;
  GObjectClass *contexts = g_type_class_ref(WEBKIT_TYPE_WEB_CONTEXT);
  if (contexts->constructed != sandboxed_constructed) {
    context_constructed = contexts->constructed;
    contexts->constructed = sandboxed_constructed;
  }
  WebKitWebContext *context = webkit_web_context_get_default();
  webkit_web_context_set_sandbox_enabled(context, TRUE);
  return webkit_web_context_get_sandbox_enabled(context);
}

static gboolean drag_data(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 5 || !WEBKIT_IS_WEB_VIEW(g_value_get_object(&params[0]))) return TRUE;
  GtkSelectionData *selection = g_value_get_boxed(&params[4]);
  gchar **uris = selection ? gtk_selection_data_get_uris(selection) : NULL;
  if (!uris) return TRUE;
  GPtrArray *paths = g_ptr_array_new();
  for (gchar **uri = uris; *uri && paths->len < 8; uri++) {
    gchar *path = g_filename_from_uri(*uri, NULL, NULL);
    if (path && g_file_test(path, G_FILE_TEST_IS_REGULAR))
      g_ptr_array_add(paths, path);
    else
      g_free(path);
  }
  g_strfreev(uris);
  g_ptr_array_add(paths, NULL);
  g_mutex_lock(&drop_lock);
  g_strfreev(dropped);
  dropped = (gchar **)g_ptr_array_free(paths, FALSE);
  dropped_at = g_get_monotonic_time();
  g_mutex_unlock(&drop_lock);
  return TRUE;
}

static gboolean drag_drop(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 1 || !WEBKIT_IS_WEB_VIEW(g_value_get_object(&params[0]))) return TRUE;
  g_mutex_lock(&drop_lock);
  drop_landed = g_get_monotonic_time();
  g_mutex_unlock(&drop_lock);
  return TRUE;
}

static bool is_paste_key(GdkEventKey *key) {
  GdkModifierType mods = key->state & gtk_accelerator_get_default_mod_mask();
  guint latin = 0;
  if (key->window) gdk_keymap_translate_keyboard_state(gdk_keymap_get_for_display(gdk_window_get_display(key->window)), key->hardware_keycode, key->state, 0, &latin, NULL, NULL, NULL);
  guint typed = gdk_keyval_to_lower(key->keyval);
  latin = gdk_keyval_to_lower(latin);
  if (mods == GDK_CONTROL_MASK) return typed == GDK_KEY_v || latin == GDK_KEY_v;
  return mods == GDK_SHIFT_MASK && (key->keyval == GDK_KEY_Insert || key->keyval == GDK_KEY_KP_Insert);
}

static gboolean paste_key(GSignalInvocationHint *hint, guint n, const GValue *params, gpointer data) {
  (void)hint;
  (void)data;
  if (n < 2 || !WEBKIT_IS_WEB_VIEW(g_value_get_object(&params[0]))) return TRUE;
  GdkEvent *event = g_value_get_boxed(&params[1]);
  if (!event || event->type != GDK_KEY_PRESS || !is_paste_key(&event->key)) return TRUE;
  g_mutex_lock(&paste_lock);
  paste_key_at = g_get_monotonic_time();
  g_mutex_unlock(&paste_lock);
  return TRUE;
}

static bool read_paste(gconstpointer arg) {
  (void)arg;
  GtkClipboard *clipboard = gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
  GBytes *bytes = NULL;
  GtkSelectionData *png = gtk_clipboard_wait_for_contents(clipboard, gdk_atom_intern_static_string("image/png"));
  if (png && gtk_selection_data_get_length(png) > 0) bytes = g_bytes_new(gtk_selection_data_get_data(png), (gsize)gtk_selection_data_get_length(png));
  if (png) gtk_selection_data_free(png);
  if (!bytes) {
    GdkPixbuf *image = gtk_clipboard_wait_for_image(clipboard);
    gchar *buffer = NULL;
    gsize size = 0;
    if (image && gdk_pixbuf_save_to_buffer(image, &buffer, &size, "png", NULL, NULL)) bytes = g_bytes_new_take(buffer, size);
    if (image) g_object_unref(image);
  }
  g_mutex_lock(&paste_lock);
  if (pasted) g_bytes_unref(pasted);
  pasted = bytes;
  g_mutex_unlock(&paste_lock);
  return bytes != NULL;
}

static const Hook DENY = {webkit_web_view_get_type, "permission-request", deny_request};
static const Hook WATCH = {webkit_web_view_get_type, "web-process-terminated", process_ended};
static const Hook COMMITS = {webkit_web_view_get_type, "load-changed", load_changed};
static const Hook PAGE_ONLY = {webkit_web_view_get_type, "decide-policy", only_the_page};
static const Hook DOWNLOADS = {webkit_web_context_get_type, "download-started", download_started};
static const Hook DESTINATIONS = {webkit_download_get_type, "decide-destination", decide_destination};
static const Hook DROP_DATA = {gtk_widget_get_type, "drag-data-received", drag_data};
static const Hook DROPS = {gtk_widget_get_type, "drag-drop", drag_drop};
static bool watching_drops = false;
static const Hook PASTE_KEYS = {webkit_web_view_get_type, "key-press-event", paste_key};
static bool watching_paste = false;
static bool guarding_downloads = false;
static bool allowing_only = false;
static bool watching_commits = false;

bool kiwi_deny_permissions(void) {
  return on_main(install_hook, &DENY);
}

bool kiwi_watch_page(void (*gone)(void)) {
  page_gone = gone;
  return on_main(install_hook, &WATCH);
}

bool kiwi_watch_commits(void) {
  if (watching_commits) return true;
  watching_commits = on_main(install_hook, &COMMITS);
  return watching_commits;
}

size_t kiwi_committed_url(char *out, size_t size) {
  g_mutex_lock(&committed_lock);
  size_t n = g_strlcpy(out, committed, size);
  g_mutex_unlock(&committed_lock);
  return n;
}

bool kiwi_guard_downloads(void) {
  if (!guarding_downloads) guarding_downloads = on_main(install_hook, &DOWNLOADS) && on_main(install_hook, &DESTINATIONS);
  return guarding_downloads;
}

bool kiwi_allow_only(const char *page) {
  if (!page || !*page) return false;
  g_free(the_page);
  the_page = g_strdup(page);
  if (!allowing_only) allowing_only = on_main(install_hook, &PAGE_ONLY);
  return allowing_only;
}

bool kiwi_watch_drops(void) {
  if (!watching_drops) watching_drops = on_main(install_hook, &DROP_DATA) && on_main(install_hook, &DROPS);
  return watching_drops;
}

size_t kiwi_take_drop(char *out, size_t size) {
  g_mutex_lock(&drop_lock);
  gint64 now = g_get_monotonic_time();
  gint64 window = 10 * G_TIME_SPAN_SECOND;
  size_t n = 0;
  if (dropped && *dropped && drop_landed && now - drop_landed < window && now - dropped_at < window) {
    gchar *joined = g_strjoinv("\n", dropped);
    n = g_strlcpy(out, joined, size);
    g_free(joined);
  }
  g_strfreev(dropped);
  dropped = NULL;
  dropped_at = 0;
  drop_landed = 0;
  g_mutex_unlock(&drop_lock);
  return n;
}

bool kiwi_watch_paste(void) {
  if (!watching_paste) watching_paste = on_main(install_hook, &PASTE_KEYS);
  return watching_paste;
}

size_t kiwi_take_paste(void) {
  g_mutex_lock(&paste_lock);
  gint64 at = paste_key_at;
  paste_key_at = 0;
  g_mutex_unlock(&paste_lock);
  if (!at || g_get_monotonic_time() - at > 2 * G_TIME_SPAN_SECOND || !on_main(read_paste, NULL)) return 0;
  g_mutex_lock(&paste_lock);
  size_t n = pasted ? g_bytes_get_size(pasted) : 0;
  g_mutex_unlock(&paste_lock);
  return n;
}

size_t kiwi_paste_bytes(uint8_t *out, size_t size) {
  g_mutex_lock(&paste_lock);
  size_t n = 0;
  if (pasted) {
    gsize len = 0;
    const void *data = g_bytes_get_data(pasted, &len);
    if (out && len <= size) {
      memcpy(out, data, len);
      n = len;
    }
    g_bytes_unref(pasted);
    pasted = NULL;
  }
  g_mutex_unlock(&paste_lock);
  return n;
}

#define LAUNCHER_ENTRY "com.canonical.Unity.LauncherEntry"
#define LAUNCHER_PATH "/com/canonical/unity/launcherentry/channels_desktop"

bool kiwi_badge(int32_t count) {
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) return false;
  GVariantBuilder props;
  g_variant_builder_init(&props, G_VARIANT_TYPE("a{sv}"));
  g_variant_builder_add(&props, "{sv}", "count", g_variant_new_int64(count > 0 ? count : 0));
  g_variant_builder_add(&props, "{sv}", "count-visible", g_variant_new_boolean(count > 0));
  bool sent = g_dbus_connection_emit_signal(bus, NULL, LAUNCHER_PATH, LAUNCHER_ENTRY, "Update", g_variant_new("(sa{sv})", "application://" KIWI_APP_ID ".desktop", &props), NULL);
  g_dbus_connection_flush_sync(bus, NULL, NULL);
  g_object_unref(bus);
  return sent;
}

static bool tray_library(void) {
  void *lib = dlopen(TRAY_LIBRARY, RTLD_LAZY | RTLD_LOCAL);
  if (!lib) return false;
  dlclose(lib);
  return true;
}

bool kiwi_tray_host(void) {
  if (!tray_library()) return false;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!bus) return false;
  GVariant *reply = g_dbus_connection_call_sync(bus, TRAY_WATCHER, "/StatusNotifierWatcher", "org.freedesktop.DBus.Properties", "Get", g_variant_new("(ss)", TRAY_WATCHER, "IsStatusNotifierHostRegistered"),
                                                G_VARIANT_TYPE("(v)"), G_DBUS_CALL_FLAGS_NO_AUTO_START, 1000, NULL, NULL);
  g_object_unref(bus);
  if (!reply) return false;
  GVariant *value = NULL;
  g_variant_get(reply, "(v)", &value);
  bool host = g_variant_is_of_type(value, G_VARIANT_TYPE_BOOLEAN) && g_variant_get_boolean(value);
  g_variant_unref(value);
  g_variant_unref(reply);
  return host;
}

static GDBusConnection *scheme_bus = NULL;
static gboolean dark_before = FALSE;

static gint scheme_of(GVariant *value) {
  GVariant *v = g_variant_ref(value);
  while (g_variant_is_of_type(v, G_VARIANT_TYPE_VARIANT)) {
    GVariant *inner = g_variant_get_variant(v);
    g_variant_unref(v);
    v = inner;
  }
  gint scheme = g_variant_is_of_type(v, G_VARIANT_TYPE_UINT32) ? (gint)g_variant_get_uint32(v) : -1;
  g_variant_unref(v);
  return scheme;
}

static void use_scheme(gint scheme) {
  GtkSettings *settings = gtk_settings_get_default();
  if (!settings || scheme < 0) return;
  g_object_set(settings, "gtk-application-prefer-dark-theme", scheme == 1 ? TRUE : scheme == 2 ? FALSE : dark_before, NULL);
}

static void scheme_changed(GDBusConnection *bus, const gchar *sender, const gchar *path, const gchar *iface, const gchar *signal, GVariant *params, gpointer data) {
  (void)bus;
  (void)sender;
  (void)path;
  (void)iface;
  (void)signal;
  (void)data;
  if (!g_variant_is_of_type(params, G_VARIANT_TYPE("(ssv)"))) return;
  const gchar *ns = NULL;
  const gchar *key = NULL;
  GVariant *value = NULL;
  g_variant_get(params, "(&s&sv)", &ns, &key, &value);
  if (g_strcmp0(ns, APPEARANCE) == 0 && g_strcmp0(key, COLOR_SCHEME) == 0) use_scheme(scheme_of(value));
  g_variant_unref(value);
}

static void read_scheme(bool one);

static void scheme_read(GObject *source, GAsyncResult *res, gpointer data) {
  GError *error = NULL;
  GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), res, &error);
  if (!reply) {
    if (GPOINTER_TO_INT(data) && g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD)) read_scheme(false);
    g_error_free(error);
    return;
  }
  GVariant *value = NULL;
  g_variant_get(reply, "(v)", &value);
  use_scheme(scheme_of(value));
  g_variant_unref(value);
  g_variant_unref(reply);
}

static void read_scheme(bool one) {
  g_dbus_connection_call(scheme_bus, PORTAL, PORTAL_PATH, PORTAL_SETTINGS, one ? "ReadOne" : "Read", g_variant_new("(ss)", APPEARANCE, COLOR_SCHEME), G_VARIANT_TYPE("(v)"), G_DBUS_CALL_FLAGS_NONE, 5000,
                         NULL, scheme_read, GINT_TO_POINTER(one));
}

static bool follow_on_main(gconstpointer arg) {
  (void)arg;
  if (scheme_bus) return true;
  GtkSettings *settings = gtk_settings_get_default();
  if (!settings) return false;
  scheme_bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!scheme_bus) return false;
  g_object_get(settings, "gtk-application-prefer-dark-theme", &dark_before, NULL);
  g_dbus_connection_signal_subscribe(scheme_bus, PORTAL, PORTAL_SETTINGS, "SettingChanged", PORTAL_PATH, APPEARANCE, G_DBUS_SIGNAL_FLAGS_NONE, scheme_changed, NULL, NULL);
  read_scheme(true);
  return true;
}

bool kiwi_follow_color_scheme(void) {
  return on_main(follow_on_main, NULL);
}

typedef struct {
  guint key;
  GdkModifierType mods;
  gint action;
} Shortcut;

static const Shortcut SHORTCUTS[] = {
    {GDK_KEY_equal, GDK_CONTROL_MASK, 1}, {GDK_KEY_plus, GDK_CONTROL_MASK, 1}, {GDK_KEY_KP_Add, GDK_CONTROL_MASK, 1}, {GDK_KEY_minus, GDK_CONTROL_MASK, 2},
    {GDK_KEY_KP_Subtract, GDK_CONTROL_MASK, 2}, {GDK_KEY_0, GDK_CONTROL_MASK, 3}, {GDK_KEY_KP_0, GDK_CONTROL_MASK, 3}, {GDK_KEY_r, GDK_CONTROL_MASK, 4},
    {GDK_KEY_q, GDK_CONTROL_MASK, 5}, {GDK_KEY_w, GDK_CONTROL_MASK, 6}, {GDK_KEY_F11, 0, 7},
};

static void (*shortcut_pressed)(int32_t action) = NULL;

static gboolean shortcut(GtkAccelGroup *group, GObject *target, guint key, GdkModifierType mods, gpointer data) {
  (void)group;
  (void)target;
  (void)key;
  (void)mods;
  if (shortcut_pressed) shortcut_pressed(GPOINTER_TO_INT(data));
  return TRUE;
}

static bool keys_on_main(gconstpointer arg) {
  gpointer window = (gpointer)arg;
  if (!GTK_IS_WINDOW(window)) return false;
  GtkAccelGroup *group = gtk_accel_group_new();
  for (size_t i = 0; i < G_N_ELEMENTS(SHORTCUTS); i++)
    gtk_accel_group_connect(group, SHORTCUTS[i].key, SHORTCUTS[i].mods, 0, g_cclosure_new(G_CALLBACK(shortcut), GINT_TO_POINTER(SHORTCUTS[i].action), NULL));
  gtk_window_add_accel_group(GTK_WINDOW(window), group);
  g_object_unref(group);
  return true;
}

bool kiwi_window_keys(void *window, void (*pressed)(int32_t action)) {
  if (!window || !pressed) return false;
  shortcut_pressed = pressed;
  return on_main(keys_on_main, window);
}

typedef struct {
  gpointer window;
  gint min_width;
  gint min_height;
  guint32 light;
  guint32 dark;
} Look;

static GtkCssProvider *look_css = NULL;
static guint32 look_light = 0;
static gboolean look_clear = FALSE;
static guint32 look_dark = 0;

static void paint_background(void) {
  gboolean dark = FALSE;
  g_object_get(gtk_settings_get_default(), "gtk-application-prefer-dark-theme", &dark, NULL);
  gchar *css = look_clear ? g_strdup("window { background-color: transparent; }")
                          : g_strdup_printf("window { background-color: #%06x; }", (dark ? look_dark : look_light) & 0xffffff);
  gtk_css_provider_load_from_data(look_css, css, -1, NULL);
  g_free(css);
}

static void dark_flipped(GObject *settings, GParamSpec *spec, gpointer data) {
  (void)settings;
  (void)spec;
  (void)data;
  paint_background();
}

static void fit_to_screen(GtkWindow *window, gint min_width, gint min_height) {
  GdkDisplay *display = gtk_widget_get_display(GTK_WIDGET(window));
  GdkMonitor *monitor = gdk_display_get_primary_monitor(display);
  if (!monitor && gdk_display_get_n_monitors(display) > 0) monitor = gdk_display_get_monitor(display, 0);
  if (!monitor) return;
  GdkRectangle area;
  gdk_monitor_get_workarea(monitor, &area);
  gint width = 0;
  gint height = 0;
  gtk_window_get_default_size(window, &width, &height);
  gint fit_width = MAX(min_width, MIN(width, area.width * 9 / 10));
  gint fit_height = MAX(min_height, MIN(height, area.height * 9 / 10));
  if (fit_width == width && fit_height == height) return;
  gtk_window_set_default_size(window, fit_width, fit_height);
  gtk_window_resize(window, fit_width, fit_height);
}

static bool look_on_main(gconstpointer arg) {
  Look *look = (Look *)arg;
  bool ok = GTK_IS_WINDOW(look->window);
  if (ok) {
    GtkWindow *window = GTK_WINDOW(look->window);
    GdkGeometry hints = {0};
    hints.min_width = look->min_width;
    hints.min_height = look->min_height;
    gtk_window_set_geometry_hints(window, NULL, &hints, GDK_HINT_MIN_SIZE);
    fit_to_screen(window, look->min_width, look->min_height);
    look_light = look->light;
    look_dark = look->dark;
    if (!look_css) {
      look_css = gtk_css_provider_new();
      gtk_style_context_add_provider(gtk_widget_get_style_context(GTK_WIDGET(window)), GTK_STYLE_PROVIDER(look_css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
      g_signal_connect(gtk_settings_get_default(), "notify::gtk-application-prefer-dark-theme", G_CALLBACK(dark_flipped), NULL);
    }
    paint_background();
  }
  g_free(look);
  return ok;
}

void kiwi_window_look(void *window, double min_width, double min_height, uint32_t light, uint32_t dark) {
  if (!window) return;
  Look *look = g_new0(Look, 1);
  look->window = window;
  look->min_width = (gint)min_width;
  look->min_height = (gint)min_height;
  look->light = light;
  look->dark = dark;
  on_main(look_on_main, look);
}

typedef struct {
  gchar *title;
  gchar *body;
} Note;

static GDBusConnection *notes_bus = NULL;
static GHashTable *notes_ours = NULL;
static gpointer notes_window = NULL;
static void (*notes_clicked)(void) = NULL;

static void note_signal(GDBusConnection *bus, const gchar *sender, const gchar *path, const gchar *iface, const gchar *signal, GVariant *params, gpointer data) {
  (void)bus;
  (void)sender;
  (void)path;
  (void)iface;
  (void)data;
  guint32 id = 0;
  const gchar *text = NULL;
  if (g_strcmp0(signal, "ActivationToken") == 0 && g_variant_is_of_type(params, G_VARIANT_TYPE("(us)"))) {
    g_variant_get(params, "(u&s)", &id, &text);
    if (g_hash_table_contains(notes_ours, GUINT_TO_POINTER(id))) g_hash_table_replace(notes_ours, GUINT_TO_POINTER(id), g_strdup(text));
  } else if (g_strcmp0(signal, "ActionInvoked") == 0 && g_variant_is_of_type(params, G_VARIANT_TYPE("(us)"))) {
    g_variant_get(params, "(u&s)", &id, &text);
    if (g_strcmp0(text, "default") != 0 || !g_hash_table_contains(notes_ours, GUINT_TO_POINTER(id))) return;
    const gchar *token = g_hash_table_lookup(notes_ours, GUINT_TO_POINTER(id));
    if (token && *token && GTK_IS_WINDOW(notes_window)) gtk_window_set_startup_id(GTK_WINDOW(notes_window), token);
    if (notes_clicked) notes_clicked();
  } else if (g_strcmp0(signal, "NotificationClosed") == 0 && g_variant_is_of_type(params, G_VARIANT_TYPE("(uu)"))) {
    g_variant_get(params, "(uu)", &id, NULL);
    g_hash_table_remove(notes_ours, GUINT_TO_POINTER(id));
  }
}

static void note_shown(GObject *source, GAsyncResult *res, gpointer data) {
  (void)data;
  GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), res, NULL);
  if (!reply) return;
  guint32 id = 0;
  g_variant_get(reply, "(u)", &id);
  g_variant_unref(reply);
  if (id) g_hash_table_insert(notes_ours, GUINT_TO_POINTER(id), g_strdup(""));
}

static void note_free(Note *note) {
  g_free(note->title);
  g_free(note->body);
  g_free(note);
}

static void note_capabilities(GObject *source, GAsyncResult *res, gpointer data) {
  Note *note = data;
  GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), res, NULL);
  bool markup = false;
  if (reply) {
    GVariantIter *caps = NULL;
    const gchar *cap = NULL;
    g_variant_get(reply, "(as)", &caps);
    while (g_variant_iter_next(caps, "&s", &cap))
      if (strcmp(cap, "body-markup") == 0) markup = true;
    g_variant_iter_free(caps);
    g_variant_unref(reply);
  }
  gchar *body = markup ? g_markup_escape_text(note->body, -1) : g_strdup(note->body);
  GVariantBuilder actions;
  g_variant_builder_init(&actions, G_VARIANT_TYPE("as"));
  g_variant_builder_add(&actions, "s", "default");
  g_variant_builder_add(&actions, "s", "Open Channels");
  GVariantBuilder hints;
  g_variant_builder_init(&hints, G_VARIANT_TYPE("a{sv}"));
  g_variant_builder_add(&hints, "{sv}", "desktop-entry", g_variant_new_string(KIWI_APP_ID));
  g_variant_builder_add(&hints, "{sv}", "urgency", g_variant_new_byte(1));
  g_dbus_connection_call(notes_bus, NOTES, NOTES_PATH, NOTES, "Notify", g_variant_new("(susssasa{sv}i)", "Channels Livewire", 0, KIWI_APP_ID, note->title, body, &actions, &hints, -1), G_VARIANT_TYPE("(u)"),
                         G_DBUS_CALL_FLAGS_NONE, 10000, NULL, note_shown, NULL);
  g_free(body);
  note_free(note);
}

static bool notes_ready(void) {
  if (notes_bus) return true;
  notes_bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (!notes_bus) return false;
  notes_ours = g_hash_table_new_full(NULL, NULL, NULL, g_free);
  g_dbus_connection_signal_subscribe(notes_bus, NOTES, NOTES, NULL, NOTES_PATH, NULL, G_DBUS_SIGNAL_FLAGS_NONE, note_signal, NULL, NULL);
  return true;
}

static bool notify_on_main(gconstpointer arg) {
  Note *note = (Note *)arg;
  if (!notes_ready()) {
    note_free(note);
    return false;
  }
  g_dbus_connection_call(notes_bus, NOTES, NOTES_PATH, NOTES, "GetCapabilities", NULL, G_VARIANT_TYPE("(as)"), G_DBUS_CALL_FLAGS_NONE, 5000, NULL, note_capabilities, note);
  return true;
}

bool kiwi_notify(const char *title, const char *body) {
  if (!title) return false;
  Note *note = g_new0(Note, 1);
  note->title = g_strdup(title);
  note->body = g_strdup(body ? body : "");
  return on_main(notify_on_main, note);
}

static bool clicks_on_main(gconstpointer arg) {
  notes_window = (gpointer)arg;
  return notes_ready();
}

bool kiwi_notify_clicks(void *window, void (*clicked)(void)) {
  if (!window || !clicked) return false;
  notes_clicked = clicked;
  return on_main(clicks_on_main, window);
}

static bool refuse_sandbox(char *why, size_t size, const char *text) {
  if (why && size) g_strlcpy(why, text, size);
  return false;
}

bool kiwi_sandbox_pages(char *why, size_t size) {
  if (why && size) why[0] = 0;
  if (!has_program("bwrap") || !has_program("xdg-dbus-proxy")) return refuse_sandbox(why, size, "bwrap or xdg-dbus-proxy isn't installed");
  gchar *refusal = bwrap_refusal();
  if (refusal) {
    refuse_sandbox(why, size, refusal);
    g_free(refusal);
    return false;
  }
  gchar *early = started_webkit();
  if (early) {
    gchar *text = g_strdup_printf("WebKitGTK started its %s before the sandbox was asked for, and its processes stay outside it", early);
    refuse_sandbox(why, size, text);
    g_free(text);
    g_free(early);
    return false;
  }
  return on_main(sandbox_contexts, NULL) || refuse_sandbox(why, size, "WebKitGTK's default context didn't turn it on");
}

size_t kiwi_image_pixels_sized(const char *path, int width, int height, uint8_t *out, size_t size) {
  size_t need = (size_t)width * height * 4;
  if (!path || !out || width <= 0 || height <= 0 || size < need) return 0;
  GdkPixbuf *loaded = gdk_pixbuf_new_from_file_at_scale(path, width * 4, height * 4, FALSE, NULL);
  if (!loaded) return 0;
  GdkPixbuf *small = gdk_pixbuf_scale_simple(loaded, width, height, GDK_INTERP_BILINEAR);
  g_object_unref(loaded);
  if (!small) return 0;
  int channels = gdk_pixbuf_get_n_channels(small);
  int stride = gdk_pixbuf_get_rowstride(small);
  const guchar *pixels = gdk_pixbuf_get_pixels(small);
  bool ok = gdk_pixbuf_get_bits_per_sample(small) == 8 && channels >= 3;
  for (int y = 0; ok && y < height; y++) {
    for (int x = 0; x < width; x++) {
      const guchar *p = pixels + y * stride + x * channels;
      uint8_t *o = out + ((size_t)y * width + x) * 4;
      o[0] = p[0];
      o[1] = p[1];
      o[2] = p[2];
      o[3] = channels == 4 ? p[3] : 255;
    }
  }
  g_object_unref(small);
  return ok ? need : 0;
}

static bool clear_on_main(gconstpointer arg) {
  (void)arg;
  look_clear = TRUE;
  if (look_css) paint_background();
  return true;
}

void kiwi_window_clear(void) {
  on_main(clear_on_main, NULL);
}

size_t kiwi_image_pixels(const char *path, uint8_t *out, size_t size) {
  return kiwi_image_pixels_sized(path, 24, 24, out, size);
}

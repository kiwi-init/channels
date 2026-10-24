#include <gdk/gdk.h>
#include <glib-object.h>
#include <stdbool.h>
#include <string.h>
#include <webkit2/webkit2.h>

#define KIWI_APP_ID "channels-desktop"
#define TRAY_WATCHER "org.kde.StatusNotifierWatcher"

static void (*page_gone)(void) = NULL;
static gchar *the_page = NULL;
static GMutex committed_lock;
static char committed[4096] = "";

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

static bool sandbox_default_context(gconstpointer arg) {
  (void)arg;
  WebKitWebContext *context = webkit_web_context_get_default();
  webkit_web_context_set_sandbox_enabled(context, TRUE);
  return webkit_web_context_get_sandbox_enabled(context);
}

static const Hook DENY = {webkit_web_view_get_type, "permission-request", deny_request};
static const Hook WATCH = {webkit_web_view_get_type, "web-process-terminated", process_ended};
static const Hook COMMITS = {webkit_web_view_get_type, "load-changed", load_changed};
static const Hook PAGE_ONLY = {webkit_web_view_get_type, "decide-policy", only_the_page};
static const Hook DOWNLOADS = {webkit_web_context_get_type, "download-started", download_started};
static const Hook DESTINATIONS = {webkit_download_get_type, "decide-destination", decide_destination};
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

bool kiwi_tray_host(void) {
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
  return on_main(sandbox_default_context, NULL) || refuse_sandbox(why, size, "WebKitGTK's default context didn't turn it on");
}

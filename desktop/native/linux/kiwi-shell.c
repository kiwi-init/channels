#include <gdk/gdk.h>
#include <glib-object.h>
#include <stdbool.h>
#include <webkit2/webkit2.h>

#define KIWI_APP_ID "channels-desktop"

static void (*page_gone)(void) = NULL;
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
  const char *signal;
  GSignalEmissionHook fn;
} Hook;

static bool install_hook(gconstpointer arg) {
  const Hook *hook = arg;
  GType type = webkit_web_view_get_type();
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
                              userns_restricted() ? "; AppArmor lets only apps with a profile use user namespaces, and the .deb installs Channels' profile" : "");
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

static const Hook DENY = {"permission-request", deny_request};
static const Hook WATCH = {"web-process-terminated", process_ended};
static const Hook COMMITS = {"load-changed", load_changed};
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

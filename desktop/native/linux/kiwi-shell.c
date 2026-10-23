#include <gdk/gdk.h>
#include <glib-object.h>
#include <stdbool.h>
#include <webkit2/webkit2.h>

#define KIWI_APP_ID "channels-desktop"

static void (*page_gone)(void) = NULL;

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

typedef struct {
  const char *signal;
  GSignalEmissionHook fn;
  GMutex lock;
  GCond cond;
  bool done;
  bool ok;
} Install;

static bool install(const char *signal, GSignalEmissionHook fn) {
  GType type = webkit_web_view_get_type();
  g_type_class_ref(type);
  guint id = g_signal_lookup(signal, type);
  return id != 0 && g_signal_add_emission_hook(id, 0, fn, NULL, NULL) != 0;
}

static gboolean install_on_main(gpointer data) {
  Install *in = data;
  bool ok = install(in->signal, in->fn);
  g_mutex_lock(&in->lock);
  in->ok = ok;
  in->done = true;
  g_cond_signal(&in->cond);
  g_mutex_unlock(&in->lock);
  return G_SOURCE_REMOVE;
}

static bool hook(const char *signal, GSignalEmissionHook fn) {
  GMainContext *main = g_main_context_default();
  if (g_main_context_is_owner(main)) return install(signal, fn);
  Install *in = g_new0(Install, 1);
  in->signal = signal;
  in->fn = fn;
  g_mutex_init(&in->lock);
  g_cond_init(&in->cond);
  GSource *source = g_idle_source_new();
  g_source_set_callback(source, install_on_main, in, NULL);
  g_source_attach(source, main);
  g_source_unref(source);
  gint64 until = g_get_monotonic_time() + 10 * G_TIME_SPAN_SECOND;
  g_mutex_lock(&in->lock);
  while (!in->done && g_cond_wait_until(&in->cond, &in->lock, until)) {
  }
  bool done = in->done;
  bool ok = in->ok;
  g_mutex_unlock(&in->lock);
  if (done) {
    g_mutex_clear(&in->lock);
    g_cond_clear(&in->cond);
    g_free(in);
  }
  return done && ok;
}

bool kiwi_deny_permissions(void) {
  return hook("permission-request", deny_request);
}

bool kiwi_watch_page(void (*gone)(void)) {
  page_gone = gone;
  return hook("web-process-terminated", process_ended);
}

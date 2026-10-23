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

static bool hook(const char *signal, GSignalEmissionHook fn) {
  guint id = g_signal_lookup(signal, webkit_web_view_get_type());
  return id != 0 && g_signal_add_emission_hook(id, 0, fn, NULL, NULL) != 0;
}

bool kiwi_deny_permissions(void) {
  return hook("permission-request", deny_request);
}

bool kiwi_watch_page(void (*gone)(void)) {
  page_gone = gone;
  return hook("web-process-terminated", process_ended);
}

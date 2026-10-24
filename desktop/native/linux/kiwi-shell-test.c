#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <webkit2/webkit2.h>

static GMainLoop *loop;
static char *verdict = NULL;
static int allowed_by_handler = 0;
static int ended = 0;
static int downloads_started = 0;
static int downloads_saved = 0;
static int downloads_cancelled = 0;
static char *download_dir = NULL;

static void gone(void) { ended++; }

static gboolean allow_everything(WebKitWebView *view, WebKitPermissionRequest *request, gpointer data) {
  (void)view;
  (void)data;
  allowed_by_handler++;
  webkit_permission_request_allow(request);
  return TRUE;
}

static void title_changed(GObject *view, GParamSpec *spec, gpointer data) {
  (void)spec;
  (void)data;
  const char *title = webkit_web_view_get_title(WEBKIT_WEB_VIEW(view));
  if (!title || !*title) return;
  verdict = g_strdup(title);
  g_main_loop_quit(loop);
}

static gboolean use_everything(WebKitWebView *view, WebKitPolicyDecision *decision, WebKitPolicyDecisionType type, gpointer data) {
  (void)view;
  (void)type;
  (void)data;
  webkit_policy_decision_use(decision);
  return TRUE;
}

static gboolean save_into_temp(WebKitDownload *download, gchar *suggested, gpointer data) {
  (void)suggested;
  (void)data;
  gchar *file = g_build_filename(download_dir, "download", NULL);
  gchar *uri = g_filename_to_uri(file, NULL, NULL);
  webkit_download_set_allow_overwrite(download, TRUE);
  webkit_download_set_destination(download, uri);
  g_free(uri);
  g_free(file);
  return TRUE;
}

static void download_finished(WebKitDownload *download, gpointer data) {
  (void)data;
  if (!g_object_get_data(G_OBJECT(download), "kiwi-failed")) downloads_saved++;
}

static void download_failed(WebKitDownload *download, GError *error, gpointer data) {
  (void)data;
  g_object_set_data(G_OBJECT(download), "kiwi-failed", GINT_TO_POINTER(1));
  if (g_error_matches(error, WEBKIT_DOWNLOAD_ERROR, WEBKIT_DOWNLOAD_ERROR_CANCELLED_BY_USER)) downloads_cancelled++;
}

static void download_started(WebKitWebContext *context, WebKitDownload *download, gpointer data) {
  (void)context;
  (void)data;
  downloads_started++;
  g_signal_connect(download, "decide-destination", G_CALLBACK(save_into_temp), NULL);
  g_signal_connect(download, "finished", G_CALLBACK(download_finished), NULL);
  g_signal_connect(download, "failed", G_CALLBACK(download_failed), NULL);
}

static gboolean stop(gpointer data);

static void spin(guint ms) {
  g_timeout_add(ms, stop, NULL);
  g_main_loop_run(loop);
}

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

typedef struct {
  bool (*deny)(void);
  bool (*watch)(void (*)(void));
  bool (*sandbox)(char *, size_t);
  bool (*commits)(void);
  bool (*downloads)(void);
  bool (*allow_only)(const char *);
  bool ok;
  bool sandboxed;
  char why[1024];
} Hooks;

static gpointer install_off_main(gpointer data) {
  Hooks *hooks = data;
  hooks->sandboxed = hooks->sandbox(hooks->why, sizeof hooks->why);
  hooks->ok = hooks->deny() && hooks->watch(gone) && hooks->commits() && hooks->downloads() && hooks->allow_only("http://localhost/");
  g_idle_add(stop, NULL);
  return NULL;
}

static gboolean install_from_worker(gpointer data) {
  g_thread_unref(g_thread_new("worker", install_off_main, data));
  return G_SOURCE_REMOVE;
}

static const char *PAGE =
    "<script>(async () => {"
    "if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { document.title = 'no media'; return; }"
    "try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); document.title = 'granted'; }"
    "catch (e) { document.title = 'refused ' + e.name; }"
    "})();</script>";

int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[2], "sandboxed") != 0 && strcmp(argv[2], "unsandboxed") != 0)) {
    fprintf(stderr, "usage: kiwi-shell-test <libkiwi-shell.so> sandboxed|unsandboxed\n");
    return 2;
  }
  bool want_sandbox = strcmp(argv[2], "sandboxed") == 0;
  gtk_init(&argc, &argv);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-shell-test: %s\n", dlerror());
    return 1;
  }
  bool (*deny)(void) = (bool (*)(void))dlsym(lib, "kiwi_deny_permissions");
  bool (*watch)(void (*)(void)) = (bool (*)(void (*)(void)))dlsym(lib, "kiwi_watch_page");
  bool (*sandbox)(char *, size_t) = (bool (*)(char *, size_t))dlsym(lib, "kiwi_sandbox_pages");
  bool (*commits)(void) = (bool (*)(void))dlsym(lib, "kiwi_watch_commits");
  size_t (*committed)(char *, size_t) = (size_t (*)(char *, size_t))dlsym(lib, "kiwi_committed_url");
  bool (*downloads)(void) = (bool (*)(void))dlsym(lib, "kiwi_guard_downloads");
  bool (*allow_only)(const char *) = (bool (*)(const char *))dlsym(lib, "kiwi_allow_only");
  int bad = 0;
  if (!deny || !watch || !sandbox || !commits || !committed || !downloads || !allow_only) {
    fprintf(stderr, "kiwi-shell-test: one of libkiwi-shell's entry points isn't exported\n");
    return 1;
  }
  if (g_strcmp0(g_get_prgname(), "channels-desktop") != 0 || g_strcmp0(gdk_get_program_class(), "channels-desktop") != 0) {
    fprintf(stderr, "kiwi-shell-test: the program is named %s, class %s, not channels-desktop\n", g_get_prgname(), gdk_get_program_class());
    bad++;
  } else
    printf("program name and class: channels-desktop (the Wayland app_id, matching channels-desktop.desktop)\n");
  loop = g_main_loop_new(NULL, FALSE);
  Hooks hooks = {deny, watch, sandbox, commits, downloads, allow_only, false, false, ""};
  g_idle_add(install_from_worker, &hooks);
  g_main_loop_run(loop);
  if (hooks.ok) printf("hooks: installed on GTK's main loop when asked from another thread, as main-eb's worker asks\n");
  bool enabled = webkit_web_context_get_sandbox_enabled(webkit_web_context_get_default());
  if (want_sandbox && (!hooks.sandboxed || !enabled)) {
    fprintf(stderr, "kiwi-shell-test: kiwi_sandbox_pages didn't turn WebKitGTK's sandbox on: %s\n", hooks.why[0] ? hooks.why : "no reason given");
    bad++;
  } else if (want_sandbox)
    printf("sandbox: on for the default context before its first web view, so the page below runs in bubblewrap\n");
  else if (hooks.sandboxed || enabled || !strstr(hooks.why, "bwrap can't build it here")) {
    fprintf(stderr, "kiwi-shell-test: with bwrap unable to build its namespaces here, kiwi_sandbox_pages left the sandbox %s and said '%s'\n", enabled ? "on" : "off", hooks.why);
    bad++;
  } else
    printf("sandbox: off, because %s; the page below runs without it instead of WebKit aborting\n", hooks.why);
  if (!hooks.ok) {
    fprintf(stderr, "kiwi-shell-test: a WebKitWebView signal hook wasn't installed from another thread\n");
    return 1;
  }

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
  WebKitSettings *settings = webkit_web_view_get_settings(view);
  g_object_set(settings, "enable-media-stream", TRUE, "enable-mock-capture-devices", TRUE, "javascript-can-open-windows-automatically", TRUE, NULL);
  g_signal_connect(view, "permission-request", G_CALLBACK(allow_everything), NULL);
  g_signal_connect(view, "decide-policy", G_CALLBACK(use_everything), NULL);
  g_signal_connect(webkit_web_view_get_context(view), "download-started", G_CALLBACK(download_started), NULL);
  download_dir = g_dir_make_tmp("kiwi-shell-test-XXXXXX", NULL);
  g_signal_connect(view, "notify::title", G_CALLBACK(title_changed), NULL);
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
  gtk_widget_show_all(window);

  guint timeout = g_timeout_add_seconds(30, stop, NULL);
  webkit_web_view_load_html(view, PAGE, "http://localhost/");
  g_main_loop_run(loop);
  g_source_remove(timeout);
  if (!verdict || strncmp(verdict, "refused NotAllowedError", 23) != 0 || allowed_by_handler) {
    fprintf(stderr, "kiwi-shell-test: the microphone request came out as '%s' (the app's own handler ran %d times)\n", verdict ? verdict : "nothing in 30s", allowed_by_handler);
    bad++;
  } else
    printf("microphone: %s, and the handler that would allow it never ran\n", verdict);

  char url[4096];
  size_t n = committed(url, sizeof url);
  if (n == 0 || n >= sizeof url || strcmp(url, "http://localhost/") != 0) {
    fprintf(stderr, "kiwi-shell-test: kiwi_committed_url gave '%s', not the page's committed http://localhost/\n", n < sizeof url ? url : "(too long)");
    bad++;
  } else
    printf("committed URL: %s, as the bridge checks it\n", url);

  webkit_web_view_load_uri(view, "http://localhost/elsewhere");
  spin(2000);
  webkit_web_view_evaluate_javascript(view,
                                      "window.open('http://localhost/popup');"
                                      "const a = document.createElement('a'); a.href = 'http://localhost/blank'; a.target = '_blank'; document.body.append(a); a.click();",
                                      -1, NULL, NULL, NULL, NULL, NULL);
  spin(2000);
  n = committed(url, sizeof url);
  if (n >= sizeof url || strcmp(url, "http://localhost/") != 0) {
    fprintf(stderr, "kiwi-shell-test: with a handler that uses every navigation, the view committed '%s', not http://localhost/\n", url);
    bad++;
  } else
    printf("navigation: the view stays on http://localhost/ through a load elsewhere, a window.open and a target=_blank link, though the app's handler would use them\n");

  webkit_web_view_download_uri(view, "http://localhost/file.bin");
  spin(2000);
  int cancelled = downloads_cancelled;
  int saved_http = downloads_saved;
  webkit_web_view_download_uri(view, "data:text/plain,kiwi");
  spin(2000);
  int saved_data = downloads_saved;
  webkit_web_view_evaluate_javascript(view, "location.href = 'data:text/plain,navigated'", -1, NULL, NULL, NULL, NULL, NULL);
  spin(2000);
  n = committed(url, sizeof url);
  if (cancelled != 1 || saved_http != 0 || saved_data != 1 || downloads_saved != 2 || n >= sizeof url || strcmp(url, "http://localhost/") != 0) {
    fprintf(stderr, "kiwi-shell-test: downloads: %d started, the http: one cancelled %d times and saved %d, data: ones saved %d (want 2), the page committed '%s'\n", downloads_started, cancelled, saved_http,
            downloads_saved, url);
    bad++;
  } else
    printf("downloads: an http: one cancelled, the page's data: ones saved, and a data: navigation made a download, not a page\n");

  webkit_web_view_terminate_web_process(view);
  g_timeout_add(2000, stop, NULL);
  g_main_loop_run(loop);
  if (ended != 1) {
    fprintf(stderr, "kiwi-shell-test: a terminated web process reached kiwi_watch_page's callback %d times, not once\n", ended);
    bad++;
  } else
    printf("web process terminated: kiwi_watch_page's callback ran\n");
  return bad ? 1 : 0;
}

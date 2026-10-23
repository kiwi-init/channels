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

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

typedef struct {
  bool (*deny)(void);
  bool (*watch)(void (*)(void));
  bool (*sandbox)(void);
  bool (*commits)(void);
  bool ok;
  bool sandboxed;
} Hooks;

static gpointer install_off_main(gpointer data) {
  Hooks *hooks = data;
  hooks->sandboxed = hooks->sandbox();
  hooks->ok = hooks->deny() && hooks->watch(gone) && hooks->commits();
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
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-shell-test <libkiwi-shell.so>\n");
    return 2;
  }
  gtk_init(&argc, &argv);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-shell-test: %s\n", dlerror());
    return 1;
  }
  bool (*deny)(void) = (bool (*)(void))dlsym(lib, "kiwi_deny_permissions");
  bool (*watch)(void (*)(void)) = (bool (*)(void (*)(void)))dlsym(lib, "kiwi_watch_page");
  bool (*sandbox)(void) = (bool (*)(void))dlsym(lib, "kiwi_sandbox_pages");
  bool (*commits)(void) = (bool (*)(void))dlsym(lib, "kiwi_watch_commits");
  size_t (*committed)(char *, size_t) = (size_t (*)(char *, size_t))dlsym(lib, "kiwi_committed_url");
  int bad = 0;
  if (!deny || !watch || !sandbox || !commits || !committed) {
    fprintf(stderr, "kiwi-shell-test: one of kiwi_deny_permissions, kiwi_watch_page, kiwi_sandbox_pages, kiwi_watch_commits or kiwi_committed_url isn't exported\n");
    return 1;
  }
  if (g_strcmp0(g_get_prgname(), "channels-desktop") != 0 || g_strcmp0(gdk_get_program_class(), "channels-desktop") != 0) {
    fprintf(stderr, "kiwi-shell-test: the program is named %s, class %s, not channels-desktop\n", g_get_prgname(), gdk_get_program_class());
    bad++;
  } else
    printf("program name and class: channels-desktop (the Wayland app_id, matching channels-desktop.desktop)\n");
  loop = g_main_loop_new(NULL, FALSE);
  Hooks hooks = {deny, watch, sandbox, commits, false, false};
  g_idle_add(install_from_worker, &hooks);
  g_main_loop_run(loop);
  if (hooks.ok) printf("hooks: installed on GTK's main loop when asked from another thread, as main-eb's worker asks\n");
  if (!hooks.sandboxed || !webkit_web_context_get_sandbox_enabled(webkit_web_context_get_default())) {
    fprintf(stderr, "kiwi-shell-test: kiwi_sandbox_pages didn't turn WebKitGTK's sandbox on (bwrap and xdg-dbus-proxy are installed here)\n");
    bad++;
  } else
    printf("sandbox: on for the default context before its first web view, so the page below runs in bubblewrap\n");
  if (!hooks.ok) {
    fprintf(stderr, "kiwi-shell-test: a WebKitWebView signal hook wasn't installed from another thread\n");
    return 1;
  }

  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
  WebKitSettings *settings = webkit_web_view_get_settings(view);
  g_object_set(settings, "enable-media-stream", TRUE, "enable-mock-capture-devices", TRUE, NULL);
  g_signal_connect(view, "permission-request", G_CALLBACK(allow_everything), NULL);
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

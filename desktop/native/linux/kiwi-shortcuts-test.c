#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

static GMainLoop *loop;
static int32_t last = 0;
static int pressed = 0;

static void got(int32_t action) {
  last = action;
  pressed++;
}

static gboolean stop(gpointer data) {
  (void)data;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void spin(guint ms) {
  g_timeout_add(ms, stop, NULL);
  g_main_loop_run(loop);
}

typedef struct {
  bool (*keys)(void *, void (*)(int32_t));
  void *window;
  bool ok;
} Install;

static gpointer install_off_main(gpointer data) {
  Install *install = data;
  install->ok = install->keys(install->window, got);
  g_idle_add(stop, NULL);
  return NULL;
}

static gboolean install_from_worker(gpointer data) {
  g_thread_unref(g_thread_new("worker", install_off_main, data));
  return G_SOURCE_REMOVE;
}

static void press(GtkWidget *window, guint keyval, GdkModifierType state) {
  GdkDisplay *display = gdk_display_get_default();
  GdkKeymapKey *keys = NULL;
  gint n = 0;
  gdk_keymap_get_entries_for_keyval(gdk_keymap_get_for_display(display), keyval, &keys, &n);
  GdkEvent *event = gdk_event_new(GDK_KEY_PRESS);
  event->key.window = g_object_ref(gtk_widget_get_window(window));
  event->key.send_event = TRUE;
  event->key.time = GDK_CURRENT_TIME;
  event->key.state = state | (n > 0 && keys[0].level == 1 ? GDK_SHIFT_MASK : 0);
  event->key.keyval = keyval;
  event->key.hardware_keycode = n > 0 ? (guint16)keys[0].keycode : 0;
  event->key.group = n > 0 ? (guint8)keys[0].group : 0;
  gdk_event_set_device(event, gdk_seat_get_keyboard(gdk_display_get_default_seat(display)));
  gtk_main_do_event(event);
  gdk_event_free(event);
  g_free(keys);
  spin(50);
}

typedef struct {
  const char *what;
  guint keyval;
  GdkModifierType state;
  int32_t want;
} Case;

static const Case CASES[] = {
    {"Ctrl+=", GDK_KEY_equal, GDK_CONTROL_MASK, 1}, {"Ctrl++ (Ctrl+Shift+= on a US layout)", GDK_KEY_plus, GDK_CONTROL_MASK, 1}, {"Ctrl+keypad +", GDK_KEY_KP_Add, GDK_CONTROL_MASK, 1},
    {"Ctrl+-", GDK_KEY_minus, GDK_CONTROL_MASK, 2},  {"Ctrl+keypad -", GDK_KEY_KP_Subtract, GDK_CONTROL_MASK, 2},                     {"Ctrl+0", GDK_KEY_0, GDK_CONTROL_MASK, 3},
    {"Ctrl+R", GDK_KEY_r, GDK_CONTROL_MASK, 4},      {"Ctrl+Q", GDK_KEY_q, GDK_CONTROL_MASK, 5},                                       {"Ctrl+W", GDK_KEY_w, GDK_CONTROL_MASK, 6},
    {"F11", GDK_KEY_F11, 0, 7},
};

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: kiwi-shortcuts-test <libkiwi-shell.so> (under Xvfb)\n");
    return 2;
  }
  gtk_init(&argc, &argv);
  loop = g_main_loop_new(NULL, FALSE);
  void *lib = dlopen(argv[1], RTLD_NOW);
  if (!lib) {
    fprintf(stderr, "kiwi-shortcuts-test: %s\n", dlerror());
    return 1;
  }
  bool (*keys)(void *, void (*)(int32_t)) = (bool (*)(void *, void (*)(int32_t)))dlsym(lib, "kiwi_window_keys");
  if (!keys) {
    fprintf(stderr, "kiwi-shortcuts-test: kiwi_window_keys isn't exported\n");
    return 1;
  }
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  GtkWidget *entry = gtk_entry_new();
  gtk_container_add(GTK_CONTAINER(window), entry);
  gtk_widget_show_all(window);
  gtk_widget_grab_focus(entry);
  spin(300);
  Install install = {keys, window, false};
  g_idle_add(install_from_worker, &install);
  g_main_loop_run(loop);
  if (!install.ok) {
    fprintf(stderr, "kiwi-shortcuts-test: kiwi_window_keys, asked from another thread, didn't take the window\n");
    return 1;
  }
  int bad = 0;
  for (size_t i = 0; i < G_N_ELEMENTS(CASES); i++) {
    last = 0;
    press(window, CASES[i].keyval, CASES[i].state);
    if (last != CASES[i].want) {
      fprintf(stderr, "kiwi-shortcuts-test: %s, with a text field focused, gave action %d, not %d\n", CASES[i].what, last, CASES[i].want);
      bad++;
    } else
      printf("%s: action %d\n", CASES[i].what, last);
  }
  int before = pressed;
  press(window, GDK_KEY_r, 0);
  press(window, GDK_KEY_q, 0);
  press(window, GDK_KEY_equal, 0);
  const char *typed = gtk_entry_get_text(GTK_ENTRY(entry));
  if (pressed != before || g_strcmp0(typed, "rq=") != 0) {
    fprintf(stderr, "kiwi-shortcuts-test: r, q and = without Ctrl gave %d actions and the field holds '%s', not 'rq='\n", pressed - before, typed);
    bad++;
  } else
    printf("r, q and = without Ctrl: typed into the focused field, no action\n");
  return bad ? 1 : 0;
}

#include <stdio.h>
#include <string.h>
#include <wayland-client.h>

#include "fake-input-client-protocol.h"

static struct org_kde_kwin_fake_input *fake;

static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version) {
  (void)data;
  if (strcmp(interface, org_kde_kwin_fake_input_interface.name) == 0)
    fake = wl_registry_bind(registry, name, &org_kde_kwin_fake_input_interface, version < 4 ? version : 4);
}

static void global_remove(void *data, struct wl_registry *registry, uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener listener = {global, global_remove};

int main(void) {
  struct wl_display *display = wl_display_connect(NULL);
  if (!display) {
    fprintf(stderr, "kwin-input: no Wayland display\n");
    return 1;
  }
  struct wl_registry *registry = wl_display_get_registry(display);
  wl_registry_add_listener(registry, &listener, NULL);
  wl_display_roundtrip(display);
  if (!fake) {
    fprintf(stderr, "kwin-input: the compositor offers no org_kde_kwin_fake_input\n");
    return 1;
  }
  org_kde_kwin_fake_input_authenticate(fake, "kiwi wayland audit", "drives Channels in a headless session");
  wl_display_roundtrip(display);
  printf("ready %u\n", wl_proxy_get_version((struct wl_proxy *)fake));
  fflush(stdout);
  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    double x, y;
    unsigned a, b;
    if (sscanf(line, "abs %lf %lf", &x, &y) == 2)
      org_kde_kwin_fake_input_pointer_motion_absolute(fake, wl_fixed_from_double(x), wl_fixed_from_double(y));
    else if (sscanf(line, "btn %u %u", &a, &b) == 2)
      org_kde_kwin_fake_input_button(fake, a, b);
    else if (sscanf(line, "key %u %u", &a, &b) == 2)
      org_kde_kwin_fake_input_keyboard_key(fake, a, b);
    else {
      printf("bad %s", line);
      fflush(stdout);
      continue;
    }
    if (wl_display_roundtrip(display) < 0) {
      printf("lost\n");
      fflush(stdout);
      return 1;
    }
    printf("ok\n");
    fflush(stdout);
  }
  return 0;
}

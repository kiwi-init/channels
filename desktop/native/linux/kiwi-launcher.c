#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define REAL_LAUNCHER "electrobun-launcher"

extern char **environ;

static const char *const KEEP[] = {
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "PATH",
    "TMPDIR",
    "LANG",
    "LANGUAGE",
    "TZ",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "DESKTOP_SESSION",
    "KDE_FULL_SESSION",
    "KDE_SESSION_VERSION",
    "GNOME_DESKTOP_SESSION_ID",
    "SSH_AUTH_SOCK",
    "GDK_SCALE",
    "GDK_DPI_SCALE",
    "GDK_BACKEND",
    "GTK_THEME",
    "GTK_IM_MODULE",
    "QT_IM_MODULE",
    "XMODIFIERS",
    "SDL_IM_MODULE",
    "NO_AT_BRIDGE",
    "AT_SPI_BUS_ADDRESS",
    "LIBGL_ALWAYS_SOFTWARE",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "APPIMAGE",
    "APPDIR",
    "ARGV0",
    "OWD",
    NULL,
};
static const char *const KEEP_PREFIXES[] = {"LC_", "XDG_", "WEBKIT_DISABLE_", NULL};
static char *const IMPOSED[] = {"BUN_RUNTIME_TRANSPILER_CACHE_PATH=0", NULL};

static bool imposed(const char *entry, size_t len) {
  for (char *const *i = IMPOSED; *i; i++)
    if (strncmp(entry, *i, len + 1) == 0) return true;
  return false;
}

static bool kept(const char *entry) {
  const char *eq = strchr(entry, '=');
  if (!eq) return false;
  size_t len = (size_t)(eq - entry);
  if (imposed(entry, len)) return false;
  for (const char *const *k = KEEP; *k; k++)
    if (strlen(*k) == len && strncmp(entry, *k, len) == 0) return true;
  for (const char *const *p = KEEP_PREFIXES; *p; p++)
    if (len > strlen(*p) && strncmp(entry, *p, strlen(*p)) == 0) return true;
  return false;
}

static char **allowed_env(char **env) {
  size_t n = 0;
  while (env && env[n]) n++;
  size_t m = 0;
  while (IMPOSED[m]) m++;
  char **out = calloc(n + m + 1, sizeof *out);
  if (!out) return NULL;
  size_t k = 0;
  for (size_t i = 0; i < n; i++)
    if (kept(env[i])) out[k++] = env[i];
  for (size_t i = 0; i < m; i++) out[k++] = IMPOSED[i];
  out[k] = NULL;
  return out;
}

static bool real_launcher(char *out, size_t size) {
  char self[PATH_MAX];
  ssize_t len = readlink("/proc/self/exe", self, sizeof self - 1);
  if (len <= 0 || (size_t)len >= sizeof self - 1) return false;
  self[len] = '\0';
  char *slash = strrchr(self, '/');
  if (!slash) return false;
  *slash = '\0';
  int n = snprintf(out, size, "%s/%s", self, REAL_LAUNCHER);
  return n > 0 && (size_t)n < size;
}

int main(int argc, char **argv) {
  char launcher[PATH_MAX];
  char **env = allowed_env(environ);
  if (argc < 1 || !env || !real_launcher(launcher, sizeof launcher)) {
    fputs("Channels: can't find the app's launcher\n", stderr);
    return 1;
  }
  argv[0] = launcher;
  execve(launcher, argv, env);
  perror("Channels: can't start the app");
  return 127;
}

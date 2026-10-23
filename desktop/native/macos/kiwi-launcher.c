#include <limits.h>
#include <mach-o/dyld.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;

static const char *const KEEP[] = {"HOME", "USER", "LOGNAME", "TMPDIR", "PATH", "SHELL", "LANG", "__CF_USER_TEXT_ENCODING", NULL};
static const char *const KEEP_PREFIXES[] = {"LC_", "XPC_", NULL};
#ifdef KIWI_EB_TEST
static const char *const KEEP_IN_TEST_BUILDS[] = {"KIWI_EB_DRIVER", "KIWI_EB_RELAY", "CFFIXED_USER_HOME", NULL};
#else
static const char *const KEEP_IN_TEST_BUILDS[] = {NULL};
#endif

static bool listed(const char *entry, size_t len, const char *const *names) {
  for (const char *const *k = names; *k; k++)
    if (strlen(*k) == len && strncmp(entry, *k, len) == 0) return true;
  return false;
}

static bool kept(const char *entry) {
  const char *eq = strchr(entry, '=');
  if (!eq) return false;
  size_t len = (size_t)(eq - entry);
  if (listed(entry, len, KEEP) || listed(entry, len, KEEP_IN_TEST_BUILDS)) return true;
  for (const char *const *p = KEEP_PREFIXES; *p; p++)
    if (len > strlen(*p) && strncmp(entry, *p, strlen(*p)) == 0) return true;
  return false;
}

static char **allowed_env(char **env) {
  size_t n = 0;
  while (env[n]) n++;
  char **out = calloc(n + 1, sizeof *out);
  if (!out) return NULL;
  size_t k = 0;
  for (size_t i = 0; i < n; i++)
    if (kept(env[i])) out[k++] = env[i];
  out[k] = NULL;
  return out;
}

static bool electrobun_launcher(char *out, size_t size) {
  char self[PATH_MAX];
  uint32_t len = sizeof self;
  if (_NSGetExecutablePath(self, &len) != 0) return false;
  char real[PATH_MAX];
  if (!realpath(self, real)) return false;
  char *slash = strrchr(real, '/');
  if (!slash) return false;
  *slash = '\0';
  int n = snprintf(out, size, "%s/launcher", real);
  return n > 0 && (size_t)n < size;
}

int main(int argc, char **argv) {
  char launcher[PATH_MAX];
  char **env = allowed_env(environ);
  if (argc < 1 || !env || !electrobun_launcher(launcher, sizeof launcher)) {
    fputs("Channels: can't find the app's launcher\n", stderr);
    return 1;
  }
  argv[0] = launcher;
  execve(launcher, argv, env);
  perror("Channels: can't start the app");
  return 1;
}

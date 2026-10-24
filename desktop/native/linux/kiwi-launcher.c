#include <dlfcn.h>
#include <elf.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define REAL_LAUNCHER "electrobun-launcher"
#define NATIVE_WRAPPER "libNativeWrapper.so"
#define MAX_NEEDED 64

#ifndef KIWI_OS_RELEASE
#define KIWI_OS_RELEASE "/etc/os-release"
#endif

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
    "DESKTOP_STARTUP_ID",
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
static const char STARTUP_ID[] = "DESKTOP_STARTUP_ID=";
static const char ACTIVATION_TOKEN[] = "XDG_ACTIVATION_TOKEN=";

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
  if (strcmp(entry, STARTUP_ID) == 0) return false;
  for (const char *const *k = KEEP; *k; k++)
    if (strlen(*k) == len && strncmp(entry, *k, len) == 0) return true;
  for (const char *const *p = KEEP_PREFIXES; *p; p++)
    if (len > strlen(*p) && strncmp(entry, *p, strlen(*p)) == 0) return true;
  return false;
}

static char *startup_id_from(char **env) {
  const char *token = NULL;
  for (size_t i = 0; env && env[i]; i++) {
    if (strncmp(env[i], STARTUP_ID, sizeof STARTUP_ID - 1) == 0 && env[i][sizeof STARTUP_ID - 1]) return NULL;
    if (strncmp(env[i], ACTIVATION_TOKEN, sizeof ACTIVATION_TOKEN - 1) == 0) token = env[i] + sizeof ACTIVATION_TOKEN - 1;
  }
  if (!token || !*token) return NULL;
  size_t size = sizeof STARTUP_ID + strlen(token);
  char *entry = malloc(size);
  if (entry) snprintf(entry, size, "%s%s", STARTUP_ID, token);
  return entry;
}

static char **allowed_env(char **env) {
  size_t n = 0;
  while (env && env[n]) n++;
  size_t m = 0;
  while (IMPOSED[m]) m++;
  char **out = calloc(n + m + 2, sizeof *out);
  if (!out) return NULL;
  size_t k = 0;
  for (size_t i = 0; i < n; i++)
    if (kept(env[i])) out[k++] = env[i];
  char *startup = startup_id_from(env);
  if (startup) out[k++] = startup;
  for (size_t i = 0; i < m; i++) out[k++] = IMPOSED[i];
  out[k] = NULL;
  return out;
}

static const char *const LIBRARY_DIRS[] = {
    "/lib/x86_64-linux-gnu", "/usr/lib/x86_64-linux-gnu", "/lib/aarch64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/lib64", "/usr/lib64", "/lib", "/usr/lib", NULL,
};

typedef struct {
  const char *family;
  const char *ids;
  const char *install;
} Distro;

static const Distro DISTROS[] = {
    {"Ubuntu/Debian", " debian ubuntu linuxmint pop elementary ", "sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2"},
    {"Fedora/RHEL", " fedora rhel centos rocky almalinux nobara ", "sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2"},
    {"Arch/Manjaro", " arch manjaro endeavouros cachyos ", "sudo pacman -S gtk3 webkit2gtk-4.1 libayatana-appindicator librsvg"},
    {"openSUSE", " suse opensuse opensuse-leap opensuse-tumbleweed ", "sudo zypper install libgtk-3-0 libwebkit2gtk-4_1-0 libayatana-appindicator3-1 librsvg-2-2"},
    {NULL, NULL, NULL},
};

static bool bin_dir(char *out, size_t size) {
  ssize_t len = readlink("/proc/self/exe", out, size - 1);
  if (len <= 0 || (size_t)len >= size - 1) return false;
  out[len] = '\0';
  char *slash = strrchr(out, '/');
  if (!slash) return false;
  *slash = '\0';
  return true;
}

static bool real_launcher(char *out, size_t size) {
  char self[PATH_MAX];
  if (!bin_dir(self, sizeof self)) return false;
  int n = snprintf(out, size, "%s/%s", self, REAL_LAUNCHER);
  return n > 0 && (size_t)n < size;
}

static Elf64_Off file_offset(const Elf64_Phdr *ph, size_t count, Elf64_Addr addr) {
  for (size_t i = 0; i < count; i++)
    if (ph[i].p_type == PT_LOAD && addr >= ph[i].p_vaddr && addr < ph[i].p_vaddr + ph[i].p_filesz) return ph[i].p_offset + (addr - ph[i].p_vaddr);
  return 0;
}

static size_t needed_libraries(const char *path, char names[][NAME_MAX + 1], size_t max) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  struct stat st;
  if (fstat(fd, &st) != 0 || st.st_size < (off_t)sizeof(Elf64_Ehdr)) {
    close(fd);
    return 0;
  }
  size_t size = (size_t)st.st_size;
  const unsigned char *file = mmap(NULL, size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  if (file == MAP_FAILED) return 0;
  size_t n = 0;
  const Elf64_Ehdr *eh = (const Elf64_Ehdr *)file;
  if (memcmp(eh->e_ident, ELFMAG, SELFMAG) == 0 && eh->e_ident[EI_CLASS] == ELFCLASS64 && eh->e_phentsize == sizeof(Elf64_Phdr) && eh->e_phoff < size &&
      (size - eh->e_phoff) / sizeof(Elf64_Phdr) >= eh->e_phnum) {
    const Elf64_Phdr *ph = (const Elf64_Phdr *)(file + eh->e_phoff);
    for (size_t i = 0; i < eh->e_phnum; i++) {
      if (ph[i].p_type != PT_DYNAMIC || ph[i].p_offset >= size || size - ph[i].p_offset < ph[i].p_filesz) continue;
      const Elf64_Dyn *dyn = (const Elf64_Dyn *)(file + ph[i].p_offset);
      size_t entries = ph[i].p_filesz / sizeof(Elf64_Dyn);
      Elf64_Off strings = 0;
      for (size_t j = 0; j < entries && dyn[j].d_tag != DT_NULL; j++)
        if (dyn[j].d_tag == DT_STRTAB) strings = file_offset(ph, eh->e_phnum, dyn[j].d_un.d_ptr);
      if (!strings || strings >= size) break;
      for (size_t j = 0; j < entries && dyn[j].d_tag != DT_NULL && n < max; j++) {
        if (dyn[j].d_tag != DT_NEEDED || dyn[j].d_un.d_val >= size - strings) continue;
        const char *name = (const char *)file + strings + dyn[j].d_un.d_val;
        size_t len = strnlen(name, size - strings - dyn[j].d_un.d_val);
        if (len == 0 || len > NAME_MAX || memchr(name, '/', len)) continue;
        memcpy(names[n], name, len);
        names[n][len] = '\0';
        n++;
      }
      break;
    }
  }
  munmap((void *)file, size);
  return n;
}

static bool present(const char *name, const char *beside) {
  char path[PATH_MAX];
  if (snprintf(path, sizeof path, "%s/%s", beside, name) < (int)sizeof path && access(path, F_OK) == 0) return true;
  for (const char *const *dir = LIBRARY_DIRS; *dir; dir++)
    if (snprintf(path, sizeof path, "%s/%s", *dir, name) < (int)sizeof path && access(path, F_OK) == 0) return true;
  void *lib = dlopen(name, RTLD_LAZY | RTLD_LOCAL);
  if (!lib) return false;
  dlclose(lib);
  return true;
}

static const Distro *this_distro(void) {
  FILE *f = fopen(KIWI_OS_RELEASE, "r");
  if (!f) return NULL;
  char line[512];
  char ids[1100] = " ";
  while (fgets(line, sizeof line, f)) {
    const char *value = strncmp(line, "ID=", 3) == 0 ? line + 3 : strncmp(line, "ID_LIKE=", 8) == 0 ? line + 8 : NULL;
    if (!value) continue;
    for (const char *c = value; *c && *c != '\n' && strlen(ids) < sizeof ids - 2; c++) {
      if (*c == '"' || *c == '\'') continue;
      size_t at = strlen(ids);
      ids[at] = *c;
      ids[at + 1] = '\0';
    }
    strcat(ids, " ");
  }
  fclose(f);
  for (const Distro *d = DISTROS; d->family; d++) {
    char word[64];
    for (const char *w = d->ids + 1; *w;) {
      const char *end = strchr(w, ' ');
      size_t len = (size_t)(end - w);
      if (len + 3 > sizeof word) break;
      snprintf(word, sizeof word, " %.*s ", (int)len, w);
      if (strstr(ids, word)) return d;
      w = end + 1;
    }
  }
  return NULL;
}

static bool libraries_missing(void) {
  char bin[PATH_MAX];
  char wrapper[PATH_MAX];
  if (!bin_dir(bin, sizeof bin) || snprintf(wrapper, sizeof wrapper, "%s/%s", bin, NATIVE_WRAPPER) >= (int)sizeof wrapper) return false;
  static char names[MAX_NEEDED][NAME_MAX + 1];
  size_t n = needed_libraries(wrapper, names, MAX_NEEDED);
  size_t missing = 0;
  for (size_t i = 0; i < n; i++) {
    if (present(names[i], bin)) continue;
    if (!missing++) fputs("Channels can't start: this computer is missing libraries it needs:\n", stderr);
    fprintf(stderr, "  - %s\n", names[i]);
  }
  if (!missing) return false;
  const Distro *distro = this_distro();
  if (distro) {
    fprintf(stderr, "Install Channels' runtime packages (%s):\n  %s\n", distro->family, distro->install);
  } else {
    fputs("Install Channels' runtime packages for your distribution:\n", stderr);
    for (const Distro *d = DISTROS; d->family; d++) fprintf(stderr, "  %-14s %s\n", d->family, d->install);
  }
  return true;
}

int main(int argc, char **argv) {
  char launcher[PATH_MAX];
  char **env = allowed_env(environ);
  if (argc < 1 || !env || !real_launcher(launcher, sizeof launcher)) {
    fputs("Channels: can't find the app's launcher\n", stderr);
    return 1;
  }
  if (libraries_missing()) return 127;
  argv[0] = launcher;
  execve(launcher, argv, env);
  perror("Channels: can't start the app");
  return 127;
}

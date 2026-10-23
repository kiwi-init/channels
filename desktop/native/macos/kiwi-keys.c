#include "kiwi-keys.h"

#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <fts.h>
#include <limits.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

#define MAX_LINE 4096
#define MAX_SECRET 1024
#define HEX_LEN (CC_SHA256_DIGEST_LENGTH * 2)
#define STORE_ACCOUNT "store-key"

static volatile pid_t child_pid = -1;

static int fail(char *why, size_t why_len, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(why, why_len, fmt, ap);
  va_end(ap);
  return -1;
}

static bool c_string(CFStringRef s, char *out, size_t len) {
  return s && CFGetTypeID(s) == CFStringGetTypeID() && CFStringGetCString(s, out, (CFIndex)len, kCFStringEncodingUTF8);
}

static bool url_path(CFURLRef url, char *out, size_t len) {
  return url && CFURLGetFileSystemRepresentation(url, true, (UInt8 *)out, (CFIndex)len);
}

static int sha256_hex(const char *path, char out[HEX_LEN + 1]) {
  static unsigned char buf[1 << 20];
  int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  CC_SHA256_CTX ctx;
  CC_SHA256_Init(&ctx);
  for (;;) {
    ssize_t n = read(fd, buf, sizeof buf);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) {
      close(fd);
      return -1;
    }
    if (n == 0) break;
    CC_SHA256_Update(&ctx, buf, (CC_LONG)n);
  }
  close(fd);
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &ctx);
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) snprintf(out + i * 2, 3, "%02x", digest[i]);
  return 0;
}

static int check_file(CFDictionaryRef seal, const char *path, const char *rel, char *why, size_t why_len) {
  CFStringRef key = CFStringCreateWithCString(kCFAllocatorDefault, rel, kCFStringEncodingUTF8);
  if (!key) return fail(why, why_len, "%s has a name Channels can't read", rel);
  CFStringRef want = CFDictionaryGetValue(seal, key);
  CFRelease(key);
  char expected[HEX_LEN + 1];
  if (!c_string(want, expected, sizeof expected)) return fail(why, why_len, "%s isn't part of the app", rel);
  char got[HEX_LEN + 1];
  if (sha256_hex(path, got) != 0) return fail(why, why_len, "%s can't be read: %s", rel, strerror(errno));
  if (strcmp(got, expected) != 0) return fail(why, why_len, "%s was changed", rel);
  return 0;
}

int kiwi_seal_check(char *why, size_t why_len) {
  CFBundleRef bundle = CFBundleGetMainBundle();
  if (!bundle) return fail(why, why_len, "the launcher isn't in an app bundle");
  CFTypeRef seal = CFBundleGetValueForInfoDictionaryKey(bundle, CFSTR("KiwiSeal"));
  if (!seal || CFGetTypeID(seal) != CFDictionaryGetTypeID()) return fail(why, why_len, "the app's Info.plist has no KiwiSeal");
  char app[PATH_MAX], exe[PATH_MAX], contents[PATH_MAX], self[PATH_MAX];
  CFURLRef app_url = CFBundleCopyBundleURL(bundle);
  CFURLRef exe_url = CFBundleCopyExecutableURL(bundle);
  bool paths = url_path(app_url, app, sizeof app) && url_path(exe_url, exe, sizeof exe);
  if (app_url) CFRelease(app_url);
  if (exe_url) CFRelease(exe_url);
  if (!paths) return fail(why, why_len, "the app's paths can't be read");
  char joined[PATH_MAX];
  if (snprintf(joined, sizeof joined, "%s/Contents", app) >= (int)sizeof joined) return fail(why, why_len, "the app's path is too long");
  if (!realpath(joined, contents) || !realpath(exe, self)) return fail(why, why_len, "the app's paths can't be resolved: %s", strerror(errno));
  size_t base = strlen(contents) + 1;
  char *roots[] = {contents, NULL};
  FTS *fts = fts_open(roots, FTS_PHYSICAL | FTS_NOCHDIR, NULL);
  if (!fts) return fail(why, why_len, "the app can't be read: %s", strerror(errno));
  CFIndex matched = 0;
  int rc = 0;
  while (rc == 0) {
    errno = 0;
    FTSENT *e = fts_read(fts);
    if (!e) {
      if (errno != 0) rc = fail(why, why_len, "the app can't be read: %s", strerror(errno));
      break;
    }
    if (e->fts_level == 0) continue;
    const char *rel = e->fts_path + base;
    switch (e->fts_info) {
      case FTS_D:
        if (strcmp(rel, "_CodeSignature") == 0) fts_set(fts, e, FTS_SKIP);
        break;
      case FTS_DP:
        break;
      case FTS_F:
        if (strcmp(rel, "Info.plist") == 0 || strcmp(e->fts_path, self) == 0) break;
        rc = check_file(seal, e->fts_path, rel, why, why_len);
        if (rc == 0) matched++;
        break;
      default:
        rc = fail(why, why_len, "%s isn't a plain file or folder", rel);
    }
  }
  fts_close(fts);
  if (rc == 0 && matched != CFDictionaryGetCount(seal)) rc = fail(why, why_len, "%ld of the app's files are missing", (long)(CFDictionaryGetCount(seal) - matched));
  return rc;
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void b64_encode(const UInt8 *in, size_t len, char *out) {
  size_t o = 0;
  for (size_t i = 0; i < len; i += 3) {
    UInt32 v = (UInt32)in[i] << 16 | (i + 1 < len ? (UInt32)in[i + 1] << 8 : 0) | (i + 2 < len ? in[i + 2] : 0);
    out[o++] = B64[v >> 18 & 63];
    out[o++] = B64[v >> 12 & 63];
    out[o++] = i + 1 < len ? B64[v >> 6 & 63] : '=';
    out[o++] = i + 2 < len ? B64[v & 63] : '=';
  }
  out[o] = 0;
}

static int b64_value(char c) {
  const char *p = c ? strchr(B64, c) : NULL;
  return p ? (int)(p - B64) : -1;
}

static long b64_decode(const char *in, UInt8 *out, size_t cap) {
  size_t len = strlen(in);
  if (len == 0 || len % 4 != 0) return -1;
  size_t o = 0;
  for (size_t i = 0; i < len; i += 4) {
    int a = b64_value(in[i]), b = b64_value(in[i + 1]);
    bool last = i + 4 == len;
    bool pad2 = last && in[i + 2] == '=' && in[i + 3] == '=';
    bool pad1 = last && !pad2 && in[i + 3] == '=';
    int c = pad2 ? 0 : b64_value(in[i + 2]);
    int d = pad2 || pad1 ? 0 : b64_value(in[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return -1;
    UInt32 v = (UInt32)a << 18 | (UInt32)b << 12 | (UInt32)c << 6 | (UInt32)d;
    size_t n = pad2 ? 1 : pad1 ? 2 : 3;
    if (o + n > cap) return -1;
    out[o++] = (UInt8)(v >> 16);
    if (n > 1) out[o++] = (UInt8)(v >> 8);
    if (n > 2) out[o++] = (UInt8)v;
  }
  return (long)o;
}

static void reply(int fd, const char *line) {
  size_t len = strlen(line);
  char buf[MAX_LINE + 2];
  if (len > MAX_LINE) len = MAX_LINE;
  memcpy(buf, line, len);
  buf[len++] = '\n';
  for (size_t sent = 0; sent < len;) {
    ssize_t n = write(fd, buf + sent, len - sent);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return;
    sent += (size_t)n;
  }
}

static void reply_status(int fd, const char *what, OSStatus status) {
  char line[MAX_LINE], msg[512] = "";
  CFStringRef s = SecCopyErrorMessageString(status, NULL);
  if (!s || !CFStringGetCString(s, msg, sizeof msg, kCFStringEncodingUTF8)) snprintf(msg, sizeof msg, "error %d", (int)status);
  if (s) CFRelease(s);
  for (char *p = msg; *p; p++)
    if (*p == '\n' || *p == '\r') *p = ' ';
  snprintf(line, sizeof line, "fail %s: %s", what, msg);
  reply(fd, line);
}

static CFMutableDictionaryRef item_query(CFStringRef service, CFStringRef account) {
  CFMutableDictionaryRef q = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(q, kSecAttrService, service);
  CFDictionarySetValue(q, kSecAttrAccount, account);
  return q;
}

static void serve_read(int fd, CFStringRef service, CFStringRef account, const char *what) {
  CFMutableDictionaryRef q = item_query(service, account);
  CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(q, kSecMatchLimit, kSecMatchLimitOne);
  CFTypeRef out = NULL;
  OSStatus status = SecItemCopyMatching(q, &out);
  CFRelease(q);
  if (status == errSecItemNotFound) {
    reply(fd, "none");
  } else if (status != errSecSuccess) {
    reply_status(fd, what, status);
  } else if (!out || CFGetTypeID(out) != CFDataGetTypeID() || CFDataGetLength(out) > MAX_SECRET) {
    reply(fd, "fail the keychain item isn't a key Channels can use");
  } else {
    char line[MAX_LINE];
    memcpy(line, "key ", 4);
    b64_encode(CFDataGetBytePtr(out), (size_t)CFDataGetLength(out), line + 4);
    reply(fd, line);
  }
  if (out) CFRelease(out);
}

static void serve_set(int fd, CFStringRef service, CFStringRef label, const char *b64) {
  UInt8 secret[MAX_SECRET];
  long len = b64_decode(b64, secret, sizeof secret);
  if (len <= 0) {
    reply(fd, "fail the key to save isn't base64");
    return;
  }
  CFDataRef data = CFDataCreate(kCFAllocatorDefault, secret, len);
  memset(secret, 0, sizeof secret);
  CFMutableDictionaryRef q = item_query(service, CFSTR(STORE_ACCOUNT));
  CFDictionarySetValue(q, kSecValueData, data);
  CFDictionarySetValue(q, kSecAttrLabel, label);
  OSStatus status = SecItemAdd(q, NULL);
  CFRelease(q);
  CFRelease(data);
  if (status == errSecSuccess)
    reply(fd, "ok");
  else if (status == errSecDuplicateItem)
    reply(fd, "fail the keychain already holds a store key, and Channels never replaces one");
  else
    reply_status(fd, "saving the store key", status);
}

static void serve_legacy(int fd, CFArrayRef names, const char *name) {
  CFStringRef wanted = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingUTF8);
  bool known = wanted && names && CFArrayContainsValue(names, CFRangeMake(0, CFArrayGetCount(names)), wanted);
  if (!known) {
    if (wanted) CFRelease(wanted);
    reply(fd, "fail that isn't an app whose keys Channels imports");
    return;
  }
  CFStringRef service = CFStringCreateWithFormat(kCFAllocatorDefault, NULL, CFSTR("%@ Safe Storage"), wanted);
  CFStringRef account = CFStringCreateWithFormat(kCFAllocatorDefault, NULL, CFSTR("%@ Key"), wanted);
  serve_read(fd, service, account, "reading the old app's key");
  CFRelease(service);
  CFRelease(account);
  CFRelease(wanted);
}

static void serve(int fd, CFStringRef service, CFStringRef label, CFArrayRef legacy) {
  char buf[MAX_LINE + 1];
  size_t used = 0;
  for (;;) {
    ssize_t n = read(fd, buf + used, MAX_LINE - used);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return;
    used += (size_t)n;
    char *nl;
    while ((nl = memchr(buf, '\n', used)) != NULL) {
      *nl = 0;
      if (strcmp(buf, "get") == 0)
        serve_read(fd, service, CFSTR(STORE_ACCOUNT), "reading the store key");
      else if (strncmp(buf, "set ", 4) == 0)
        serve_set(fd, service, label, buf + 4);
      else if (strncmp(buf, "legacy ", 7) == 0)
        serve_legacy(fd, legacy, buf + 7);
      else
        reply(fd, "fail the launcher doesn't know that request");
      size_t rest = used - (size_t)(nl + 1 - buf);
      memmove(buf, nl + 1, rest);
      used = rest;
    }
    if (used == MAX_LINE) {
      reply(fd, "fail that request is too long");
      return;
    }
  }
}

static void forward(int sig) {
  if (child_pid > 0) kill(child_pid, sig);
}

int kiwi_run_with_keys(const char *path, char *const argv[], char *const envp[]) {
  CFBundleRef bundle = CFBundleGetMainBundle();
  CFTypeRef id = bundle ? CFBundleGetValueForInfoDictionaryKey(bundle, kCFBundleIdentifierKey) : NULL;
  if (!id || CFGetTypeID(id) != CFStringGetTypeID()) {
    fprintf(stderr, "channels: the app's Info.plist has no bundle identifier\n");
    return 1;
  }
  CFTypeRef legacy = CFBundleGetValueForInfoDictionaryKey(bundle, CFSTR("KiwiLegacyNames"));
  CFArrayRef names = legacy && CFGetTypeID(legacy) == CFArrayGetTypeID() ? legacy : NULL;
  CFStringRef label = CFStringCreateWithFormat(kCFAllocatorDefault, NULL, CFSTR("%@ store key"), id);
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, sv) != 0) {
    fprintf(stderr, "channels: no key channel: %s\n", strerror(errno));
    return 1;
  }
  fcntl(sv[0], F_SETFD, FD_CLOEXEC);
  pid_t pid = fork();
  if (pid < 0) {
    fprintf(stderr, "channels: can't start the app: %s\n", strerror(errno));
    return 1;
  }
  if (pid == 0) {
    close(sv[0]);
    if (sv[1] != KIWI_KEY_FD) {
      if (dup2(sv[1], KIWI_KEY_FD) < 0) _exit(127);
      close(sv[1]);
    }
    execve(path, argv, envp);
    _exit(127);
  }
  close(sv[1]);
  child_pid = pid;
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = forward;
  sa.sa_flags = SA_RESTART;
  sigemptyset(&sa.sa_mask);
  int signals[] = {SIGTERM, SIGINT, SIGHUP, SIGQUIT};
  for (size_t i = 0; i < sizeof signals / sizeof signals[0]; i++) sigaction(signals[i], &sa, NULL);
  serve(sv[0], id, label, names);
  close(sv[0]);
  CFRelease(label);
  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) return 1;
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

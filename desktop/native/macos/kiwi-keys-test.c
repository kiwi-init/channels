#include <CoreFoundation/CoreFoundation.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "kiwi-keys.h"

#define OUT_CAP 65536

static CFStringRef service;
static CFStringRef label;
static CFArrayRef legacy;
static char legacy_name[256];

struct server {
  int fd;
};

struct writer {
  int fd;
  const char *in;
  size_t len;
};

static void *serve_thread(void *arg) {
  struct server *s = arg;
  kiwi_serve(s->fd, service, label, legacy);
  close(s->fd);
  return NULL;
}

static void *write_thread(void *arg) {
  struct writer *w = arg;
  for (size_t sent = 0; sent < w->len;) {
    ssize_t n = write(w->fd, w->in + sent, w->len - sent);
    if (n <= 0) break;
    sent += (size_t)n;
  }
  shutdown(w->fd, SHUT_WR);
  return NULL;
}

static size_t session(const char *in, size_t len, char *out, size_t cap) {
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, sv) != 0) {
    perror("socketpair");
    exit(2);
  }
  struct server s = {sv[0]};
  struct writer w = {sv[1], in, len};
  pthread_t ts, tw;
  pthread_create(&ts, NULL, serve_thread, &s);
  pthread_create(&tw, NULL, write_thread, &w);
  size_t used = 0;
  char sink[4096];
  for (;;) {
    char *to = used < cap - 1 ? out + used : sink;
    size_t room = used < cap - 1 ? cap - 1 - used : sizeof sink;
    ssize_t n = read(sv[1], to, room);
    if (n <= 0) break;
    if (to != sink) used += (size_t)n;
  }
  out[used] = 0;
  pthread_join(tw, NULL);
  pthread_join(ts, NULL);
  close(sv[1]);
  return used;
}

struct expect_case {
  const char *what;
  const char *in;
  size_t len;
  const char *out;
};

static int failures = 0;

static void check(const char *what, const char *in, size_t len, const char *want) {
  static char out[OUT_CAP];
  session(in, len, out, sizeof out);
  bool ok = strcmp(out, want) == 0;
  printf("%s  %s\n", ok ? "ok  " : "FAIL", what);
  if (!ok) {
    printf("      want %s      got  %s\n", want, out);
    failures++;
  }
}

static void check_prefix(const char *what, const char *in, size_t len, const char *prefix) {
  static char out[OUT_CAP];
  session(in, len, out, sizeof out);
  bool ok = strncmp(out, prefix, strlen(prefix)) == 0;
  printf("%s  %s\n", ok ? "ok  " : "FAIL", what);
  if (!ok) {
    printf("      want %s...\n      got  %s\n", prefix, out);
    failures++;
  }
}

static uint64_t rng = 0x9e3779b97f4a7c15ULL;

static uint64_t next(void) {
  rng ^= rng << 13;
  rng ^= rng >> 7;
  rng ^= rng << 17;
  return rng;
}

static void fuzz(int rounds) {
  static const char *words[] = {"get", "set ", "legacy ", "done", "key ", "QQ==", "AAAA", "=", "\n", " ", "\0", "kiwi-desktop", "\xff\xfe"};
  static char in[12288];
  static char out[OUT_CAP];
  for (int r = 0; r < rounds; r++) {
    size_t len = 0;
    size_t want = next() % sizeof in;
    while (len < want) {
      if (next() % 3 == 0) {
        const char *w = words[next() % (sizeof words / sizeof words[0])];
        size_t wl = w[0] ? strlen(w) : 1;
        if (len + wl > sizeof in) break;
        memcpy(in + len, w, wl);
        len += wl;
      } else {
        in[len++] = (char)(next() & 0xff);
      }
    }
    session(in, len, out, sizeof out);
  }
  printf("ok    %d random sessions (seeded) ran to the end\n", rounds);
}

static int parser(void) {
  char too_long[5000];
  memset(too_long, 'a', sizeof too_long);
  char huge_set[2001];
  memcpy(huge_set, "set ", 4);
  memset(huge_set + 4, 'Q', sizeof huge_set - 5);
  huge_set[sizeof huge_set - 1] = '\n';
  char listed[300];
  snprintf(listed, sizeof listed, "legacy %s\n", legacy_name);

  check("no store key yet: none", "get\n", 4, "none\n");
  check("an unknown request", "dump\n", 5, "fail the launcher doesn't know that request\n");
  check("an empty line", "\n", 1, "fail the launcher doesn't know that request\n");
  check("set with no space", "set\n", 4, "fail the launcher doesn't know that request\n");
  check("set with nothing to save", "set \n", 5, "fail the key to save isn't base64\n");
  check("set with what isn't base64", "set !!!!\n", 9, "fail the key to save isn't base64\n");
  check("set with base64 cut short", "set QQ=\n", 8, "fail the key to save isn't base64\n");
  check("set with padding in the middle", "set QQ==QQ==\n", 13, "fail the key to save isn't base64\n");
  check("set with more than 1024 bytes", huge_set, sizeof huge_set, "fail the key to save isn't base64\n");
  check("a NUL inside a request", "get\0x\n", 6, "fail the launcher doesn't know that request\n");
  check("a request cut short, then the end", "ge", 2, "");
  check_prefix("a request longer than 4096 bytes is refused and ends the session", too_long, sizeof too_long, "fail that request is too long\n");
  check("legacy with no name", "legacy \n", 8, "fail that isn't an app whose keys Channels imports\n");
  check("legacy for a name not in KiwiLegacyNames", "legacy kiwi-desktop\n", 20, "fail that isn't an app whose keys Channels imports\n");
  check("legacy for a listed name with no item", listed, strlen(listed), "none\n");
  check("the first key is saved", "set QQ==\n", 9, "ok\n");
  check("a second key is refused, and the first one read back", "set QUI=\nget\n", 14, "fail the keychain already holds a store key, and Channels never replaces one\nkey QQ==\n");
  check("done ends the session: nothing after it is answered", "done\nget\nget\n", 13, "ok\n");
  check("many requests in one write, one answer each", "get\ndump\nget\n", 13, "key QQ==\nfail the launcher doesn't know that request\nkey QQ==\n");
  fuzz(1500);
  return failures ? 1 : 0;
}

int main(int argc, char **argv) {
  signal(SIGPIPE, SIG_IGN);
  CFBundleRef bundle = CFBundleGetMainBundle();
  CFTypeRef id = bundle ? CFBundleGetValueForInfoDictionaryKey(bundle, kCFBundleIdentifierKey) : NULL;
  CFTypeRef names = bundle ? CFBundleGetValueForInfoDictionaryKey(bundle, CFSTR("KiwiLegacyNames")) : NULL;
  if (!id || CFGetTypeID(id) != CFStringGetTypeID() || !names || CFGetTypeID(names) != CFArrayGetTypeID() || CFArrayGetCount(names) < 1) {
    fprintf(stderr, "run me inside a test bundle with CFBundleIdentifier and KiwiLegacyNames\n");
    return 2;
  }
  service = id;
  legacy = names;
  label = CFSTR("kiwi-keys-test store key");
  if (!CFStringGetCString(CFArrayGetValueAtIndex(legacy, 0), legacy_name, sizeof legacy_name, kCFStringEncodingUTF8)) return 2;
  if (argc > 1 && strcmp(argv[1], "seal") == 0) {
    char why[1024];
    if (kiwi_seal_check(why, sizeof why) != 0) {
      printf("refused: %s\n", why);
      return 78;
    }
    printf("sealed\n");
    return 0;
  }
  return parser();
}

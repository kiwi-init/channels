#ifndef KIWI_KEYS_H
#define KIWI_KEYS_H

#include <CoreFoundation/CoreFoundation.h>
#include <stddef.h>

#define KIWI_KEY_FD 3
#define KIWI_KEY_FD_ENV "KIWI_KEY_FD=3"

int kiwi_seal_check(char *why, size_t why_len);

int kiwi_run_with_keys(const char *path, char *const argv[], char *const envp[]);

void kiwi_serve(int fd, CFStringRef service, CFStringRef label, CFArrayRef legacy);

#endif

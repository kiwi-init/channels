#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#import <dlfcn.h>
#import <stdbool.h>
#import <stdio.h>

static int clicks = 0;

static void clicked(void) { clicks++; }

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: kiwi-notes-test <libkiwi-shell.dylib> (run from inside an .app bundle)\n");
      return 2;
    }
    [NSApplication sharedApplication];
    void *lib = dlopen(argv[1], RTLD_NOW);
    if (!lib) {
      fprintf(stderr, "kiwi-notes-test: %s\n", dlerror());
      return 1;
    }
    bool (*notifyClicks)(void *, void (*)(void)) = (bool (*)(void *, void (*)(void)))dlsym(lib, "kiwi_notify_clicks");
    if (!notifyClicks) {
      fprintf(stderr, "kiwi-notes-test: kiwi_notify_clicks isn't exported\n");
      return 1;
    }
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    if (center.delegate) {
      fprintf(stderr, "kiwi-notes-test: the notification center already had a delegate\n");
      return 1;
    }
    int bad = 0;
    __block bool asked = false;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
      asked = notifyClicks((__bridge void *)center, clicked);
    });
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1]];
    id<UNUserNotificationCenterDelegate> delegate = center.delegate;
    if (!asked || !delegate) {
      fprintf(stderr, "kiwi-notes-test: kiwi_notify_clicks, asked from another thread, %s and left the center %s a delegate\n", asked ? "said yes" : "refused", delegate ? "with" : "without");
      return 1;
    }
    printf("delegate: set on the notification center, which Electrobun leaves without one\n");

    UNNotification *none = nil;
    __block UNNotificationPresentationOptions options = 0;
    __block bool presented = false;
    [delegate userNotificationCenter:center willPresentNotification:none withCompletionHandler:^(UNNotificationPresentationOptions o) {
      options = o;
      presented = true;
    }];
    UNNotificationPresentationOptions want = UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound;
    if (!presented || (options & want) != want) {
      fprintf(stderr, "kiwi-notes-test: a notification while the app is in front is presented with options %lu, not banner, list and sound\n", (unsigned long)options);
      bad++;
    } else
      printf("in front: a notification shows as a banner, in the list and with its sound, instead of being dropped\n");

    UNNotificationResponse *click = nil;
    __block bool completed = false;
    [delegate userNotificationCenter:center didReceiveNotificationResponse:click withCompletionHandler:^{
      completed = true;
    }];
    if (clicks != 1 || !completed) {
      fprintf(stderr, "kiwi-notes-test: a click reached the app's callback %d times and %s the completion handler\n", clicks, completed ? "called" : "never called");
      bad++;
    } else
      printf("clicked: the app's callback runs once (it shows the window) and the system is told it's handled\n");
    return bad ? 1 : 0;
  }
}

#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <os/lock.h>
#import <string.h>

static void denyMedia(id self, SEL cmd, WKWebView *webView, WKSecurityOrigin *origin, WKFrameInfo *frame, WKMediaCaptureType type,
                      void (^decisionHandler)(WKPermissionDecision)) {
  decisionHandler(WKPermissionDecisionDeny);
}

static void denyGeolocation(id self, SEL cmd, WKWebView *webView, WKSecurityOrigin *origin, WKFrameInfo *frame,
                            void (^decisionHandler)(WKPermissionDecision)) {
  decisionHandler(WKPermissionDecisionDeny);
}

typedef void (*DecideDestination)(id, SEL, WKDownload *, NSURLResponse *, NSString *, void (^)(NSURL *));

static DecideDestination electrobunDestination = NULL;

static void ownDownloadsOnly(id self, SEL cmd, WKDownload *download, NSURLResponse *response, NSString *suggestedFilename,
                             void (^completionHandler)(NSURL *)) {
  NSString *scheme = download.originalRequest.URL.scheme.lowercaseString;
  if (electrobunDestination && ([scheme isEqualToString:@"blob"] || [scheme isEqualToString:@"data"])) {
    electrobunDestination(self, cmd, download, response, suggestedFilename, completionHandler);
    return;
  }
  completionHandler(nil);
}

typedef void (*DecideAction)(id, SEL, WKWebView *, WKNavigationAction *, void (^)(WKNavigationActionPolicy));

static DecideAction electrobunDecideAction = NULL;

static NSString *thePage = nil;

static BOOL isThePage(NSURL *url) {
  NSString *s = url.absoluteString;
  NSUInteger n = thePage.length;
  if (n == 0 || ![s hasPrefix:thePage]) return NO;
  return s.length == n || [s characterAtIndex:n] == '#';
}

static BOOL ownDownload(WKNavigationAction *action) {
  NSString *scheme = action.request.URL.scheme.lowercaseString;
  return action.shouldPerformDownload && ([scheme isEqualToString:@"blob"] || [scheme isEqualToString:@"data"]);
}

static void onlyThePage(id self, SEL cmd, WKWebView *webView, WKNavigationAction *action, void (^decisionHandler)(WKNavigationActionPolicy)) {
  if (isThePage(action.request.URL) || ownDownload(action)) {
    electrobunDecideAction(self, cmd, webView, action, decisionHandler);
    return;
  }
  electrobunDecideAction(self, cmd, webView, action, ^(WKNavigationActionPolicy policy) {
    decisionHandler(WKNavigationActionPolicyCancel);
  });
}

static BOOL replace(Class cls, SEL sel, IMP imp) {
  Method m = class_getInstanceMethod(cls, sel);
  if (!m) return NO;
  method_setImplementation(m, imp);
  return YES;
}

bool kiwi_deny_permissions(void) {
  Class cls = objc_getClass("MyWebViewUIDelegate");
  if (!cls) return false;
  BOOL media = replace(cls, @selector(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:), (IMP)denyMedia);
  BOOL geo = replace(cls, NSSelectorFromString(@"webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:"), (IMP)denyGeolocation);
  return media && geo;
}

bool kiwi_guard_downloads(void) {
  Class cls = objc_getClass("MyNavigationDelegate");
  if (!cls) return false;
  Method m = class_getInstanceMethod(cls, @selector(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:));
  if (!m) return false;
  if (!electrobunDestination) electrobunDestination = (DecideDestination)method_setImplementation(m, (IMP)ownDownloadsOnly);
  return electrobunDestination != NULL;
}

bool kiwi_allow_only(const char *page) {
  NSString *p = page ? [NSString stringWithUTF8String:page] : nil;
  if (p.length == 0) return false;
  Class cls = objc_getClass("MyNavigationDelegate");
  if (!cls) return false;
  Method m = class_getInstanceMethod(cls, @selector(webView:decidePolicyForNavigationAction:decisionHandler:));
  if (!m) return false;
  thePage = [p copy];
  if (!electrobunDecideAction) electrobunDecideAction = (DecideAction)method_setImplementation(m, (IMP)onlyThePage);
  return electrobunDecideAction != NULL;
}

static os_unfair_lock committedLock = OS_UNFAIR_LOCK_INIT;
static char committed[4096] = "";
static IMP commitNext = NULL;

static void committedNavigation(id self, SEL cmd, WKWebView *webView, WKNavigation *navigation) {
  const char *url = webView.URL.absoluteString.UTF8String;
  os_unfair_lock_lock(&committedLock);
  if (strlcpy(committed, url ? url : "", sizeof committed) >= sizeof committed) committed[0] = 0;
  os_unfair_lock_unlock(&committedLock);
  ((void (*)(id, SEL, WKWebView *, WKNavigation *))commitNext)(self, cmd, webView, navigation);
}

bool kiwi_watch_commits(void) {
  if (commitNext) return true;
  Class cls = objc_getClass("MyNavigationDelegate");
  Method m = cls ? class_getInstanceMethod(cls, @selector(webView:didCommitNavigation:)) : NULL;
  if (!m) return false;
  commitNext = method_setImplementation(m, (IMP)committedNavigation);
  return true;
}

size_t kiwi_committed_url(char *out, size_t size) {
  os_unfair_lock_lock(&committedLock);
  size_t n = strlcpy(out, committed, size);
  os_unfair_lock_unlock(&committedLock);
  return n;
}

static void (*pageGone)(void) = NULL;

static void pageEnded(id self, SEL cmd, WKWebView *webView) {
  if (pageGone) pageGone();
}

bool kiwi_watch_page(void (*gone)(void)) {
  Class cls = objc_getClass("MyNavigationDelegate");
  if (!cls) return false;
  pageGone = gone;
  SEL ended = @selector(webViewWebContentProcessDidTerminate:);
  return replace(cls, ended, (IMP)pageEnded) || class_addMethod(cls, ended, (IMP)pageEnded, "v@:@");
}

static NSColor *rgb(uint32_t c) {
  return [NSColor colorWithSRGBRed:((c >> 16) & 0xff) / 255.0 green:((c >> 8) & 0xff) / 255.0 blue:(c & 0xff) / 255.0 alpha:1];
}

static NSString *const FRAME_NAME = @"Channels";

void kiwi_window_look(void *ptr, double minWidth, double minHeight, uint32_t light, uint32_t dark) {
  NSWindow *window = (__bridge NSWindow *)ptr;
  dispatch_async(dispatch_get_main_queue(), ^{
    window.minSize = NSMakeSize(minWidth, minHeight);
    if ([window setFrameUsingName:FRAME_NAME]) {
      NSRect frame = window.frame;
      if (frame.size.width < minWidth || frame.size.height < minHeight)
        [window setFrame:NSMakeRect(frame.origin.x, frame.origin.y, MAX(frame.size.width, minWidth), MAX(frame.size.height, minHeight)) display:NO];
    }
    window.frameAutosaveName = FRAME_NAME;
    NSAppearanceName name = [NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]];
    window.backgroundColor = rgb([name isEqualToString:NSAppearanceNameDarkAqua] ? dark : light);
  });
}

static NSView *findWebView(NSView *view) {
  if ([view isKindOfClass:[WKWebView class]]) return view;
  for (NSView *child in view.subviews) {
    NSView *found = findWebView(child);
    if (found) return found;
  }
  return nil;
}

static NSAppearance *appearanceFor(int32_t appearance) {
  if (appearance == 1) return [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  if (appearance == 2) return [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  return nil;
}

static os_unfair_lock lookLock = OS_UNFAIR_LOCK_INIT;
static char look[64] = "";

static void noteLook(NSWindow *window) {
  NSView *content = window.contentView;
  BOOL frosted = NO;
  for (NSView *child in content.subviews)
    if ([child isKindOfClass:[NSVisualEffectView class]] && ((NSVisualEffectView *)child).material == NSVisualEffectMaterialSidebar) frosted = YES;
  WKWebView *web = (WKWebView *)findWebView(content);
  BOOL clear = web && ![[web valueForKey:@"drawsBackground"] boolValue];
  NSAppearanceName name = window.appearance.name;
  const char *appearance = !name ? "system" : [name isEqualToString:NSAppearanceNameDarkAqua] ? "dark" : "light";
  os_unfair_lock_lock(&lookLock);
  snprintf(look, sizeof look, "%s %s %s", frosted ? "frost" : "plain", clear ? "clear" : "drawn", appearance);
  os_unfair_lock_unlock(&lookLock);
}

size_t kiwi_window_looks(char *out, size_t size) {
  os_unfair_lock_lock(&lookLock);
  size_t n = strlcpy(out, look, size);
  os_unfair_lock_unlock(&lookLock);
  return n;
}

bool kiwi_window_frost(void *ptr) {
  NSWindow *window = (__bridge NSWindow *)ptr;
  if (!window) return false;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView *content = window.contentView;
    NSVisualEffectView *frost = nil;
    for (NSView *child in content.subviews)
      if ([child isKindOfClass:[NSVisualEffectView class]]) frost = (NSVisualEffectView *)child;
    if (!frost) {
      frost = [[NSVisualEffectView alloc] initWithFrame:content.bounds];
      frost.material = NSVisualEffectMaterialSidebar;
      frost.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      frost.state = NSVisualEffectStateFollowsWindowActiveState;
      frost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [content addSubview:frost positioned:NSWindowBelow relativeTo:nil];
    }
    WKWebView *web = (WKWebView *)findWebView(content);
    [web setValue:@NO forKey:@"drawsBackground"];
    web.underPageBackgroundColor = NSColor.clearColor;
    noteLook(window);
  });
  return true;
}

size_t kiwi_look_setting(const char *key, char *out, size_t size) {
  NSString *name = key ? [NSString stringWithUTF8String:key] : nil;
  id value = name.length ? [NSUserDefaults.standardUserDefaults objectForKey:name] : nil;
  const char *text = value ? [[value description] UTF8String] : "";
  return strlcpy(out, text ? text : "", size);
}

void kiwi_window_appearance(void *ptr, int32_t appearance) {
  NSWindow *window = (__bridge NSWindow *)ptr;
  if (!window) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    window.appearance = appearanceFor(appearance);
    noteLook(window);
  });
}

static void (*noteClicked)(void) = NULL;

@interface KiwiNotes : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation KiwiNotes
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  if (noteClicked && ![response.actionIdentifier isEqualToString:UNNotificationDismissActionIdentifier]) noteClicked();
  completionHandler();
}
@end

static KiwiNotes *notes = nil;

bool kiwi_notify_clicks(void *window, void (*clicked)(void)) {
  if (!clicked) return false;
  noteClicked = clicked;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!notes) notes = [KiwiNotes new];
    [UNUserNotificationCenter currentNotificationCenter].delegate = notes;
  });
  return true;
}

void kiwi_badge(int32_t count) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSApp.dockTile.badgeLabel = count > 0 ? [NSString stringWithFormat:@"%d", count] : nil;
  });
}

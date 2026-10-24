#import <AppKit/AppKit.h>
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
  if (n == 0 || s.length < n || [[s substringToIndex:n] caseInsensitiveCompare:thePage] != NSOrderedSame) return NO;
  if (s.length == n) return YES;
  unichar next = [s characterAtIndex:n];
  return next == '#' || next == '?';
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
  return replace(cls, @selector(webViewWebContentProcessDidTerminate:), (IMP)pageEnded);
}

static NSColor *rgb(uint32_t c) {
  return [NSColor colorWithSRGBRed:((c >> 16) & 0xff) / 255.0 green:((c >> 8) & 0xff) / 255.0 blue:(c & 0xff) / 255.0 alpha:1];
}

void kiwi_window_look(void *ptr, double minWidth, double minHeight, uint32_t light, uint32_t dark) {
  NSWindow *window = (__bridge NSWindow *)ptr;
  dispatch_async(dispatch_get_main_queue(), ^{
    window.minSize = NSMakeSize(minWidth, minHeight);
    NSAppearanceName name = [NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]];
    window.backgroundColor = rgb([name isEqualToString:NSAppearanceNameDarkAqua] ? dark : light);
  });
}

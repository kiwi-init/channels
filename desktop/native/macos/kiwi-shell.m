#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

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

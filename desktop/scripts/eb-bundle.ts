export const RELEASE_ID = "com.kiwiinit.channels";

export function bundleProblems(main: string, preload: string): string[] {
  const problems: string[] = [];
  const tables = main.match(/webviewTagExecuteJavascript\s*:\s*\(/g)?.length ?? 0;
  if (tables !== 1) problems.push(`the main bundle defines Electrobun's internal RPC table ${tables} times, so lockInternalRpc may not reach the one Electrobun dispatches from`);
  if (preload.length === 0) problems.push("the preload bundle is empty: window.kiwi would never exist");
  if (/\bWebSocket\b/.test(preload)) problems.push("the preload bundle uses a WebSocket: the bridge must go only through the native postMessage bridge");
  return problems;
}

export function urlSchemeProblems(infoPlist: string, identifier: string, scheme: string): string[] {
  const listed = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(infoPlist)?.[1] ?? "";
  const schemes = [...listed.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  const has = schemes.includes(scheme);
  if (identifier === RELEASE_ID) return has ? [] : [`the app registers no ${scheme}:// scheme (CFBundleURLSchemes in Info.plist), so macOS never sends it a ${scheme}:// link`];
  return has ? [`the test build ${identifier} registers ${scheme}://, so it could take links meant for the installed Channels`] : [];
}

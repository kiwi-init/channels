export function bundleProblems(main: string, preload: string): string[] {
  const problems: string[] = [];
  const tables = main.match(/webviewTagExecuteJavascript\s*:\s*\(/g)?.length ?? 0;
  if (tables !== 1) problems.push(`the main bundle defines Electrobun's internal RPC table ${tables} times, so lockInternalRpc may not reach the one Electrobun dispatches from`);
  if (preload.length === 0) problems.push("the preload bundle is empty: window.kiwi would never exist");
  if (/\bWebSocket\b/.test(preload)) problems.push("the preload bundle uses a WebSocket: the bridge must go only through the native postMessage bridge");
  return problems;
}

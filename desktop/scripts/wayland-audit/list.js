const all = workspace.windowList ? workspace.windowList() : workspace.clientList();
const active = workspace.activeWindow || workspace.activeClient;
for (const w of all) {
  const g = w.frameGeometry;
  const c = w.clientGeometry;
  print("kiwi-win " + JSON.stringify({ caption: w.caption, cls: w.resourceClass, name: w.resourceName, desktopFile: w.desktopFileName, pid: w.pid, active: w === active, minimized: w.minimized, noBorder: w.noBorder, normal: w.normalWindow, attention: w.demandsAttention, frame: [g.x, g.y, g.width, g.height], client: c ? [c.x, c.y, c.width, c.height] : null, alpha: w.decorationHasAlpha, managed: w.managed }));
}
print("kiwi-win-end");

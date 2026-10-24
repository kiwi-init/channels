const all = workspace.windowList ? workspace.windowList() : workspace.clientList();
for (const w of all) if (w.caption === "Channels") { print("kiwi-close " + w.resourceClass); w.closeWindow(); }

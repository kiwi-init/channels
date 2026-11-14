export const UI_CONTRACT = "3.7.0";

export const UI_REQUIRES = "3.0.0";

export const UI_DATA_SCHEMA = 1;

/**
 * Channel calls added after contract 1.10.0, by the contract that brought them. An older app lacks
 * them, so the UI asks `capabilities()` first (ui/src/live/app-can.ts), or the call runs in the
 * background where failing is harmless (listed in CHANNEL_CALLS_BACKGROUND).
 */
export const CHANNEL_CALLS_SINCE: Readonly<Record<string, readonly string[]>> = {
  "1.11.0": ["makeRoom", "changeRoom"],
  "1.12.0": ["makeDm"],
  "1.13.0": ["syncMarks"],
  "1.14.0": ["leaveRoom"],
  "1.15.0": ["syncGithub", "githubStatus"],
  "1.17.0": ["goneDevices"],
  "1.21.0": ["sentRooms"],
  "3.1.0": ["putImage", "putFileData", "fileData"],
  "3.2.0": ["docList", "pruneDocs", "compactDoc", "docVersions", "docVersionState"],
};

export const CHANNEL_CALLS_BACKGROUND: readonly string[] = ["syncMarks", "sentRooms", "syncGithub", "githubStatus", "goneDevices", "docList", "pruneDocs", "compactDoc"];

export type SurfaceDelta = { readonly add: readonly string[]; readonly remove: readonly string[] };

export const UI_FIRST_CONTRACT = "1.0.0";

export const UI_FIRST_SURFACES: readonly string[] = [
  "kiwi.channels",
  "kiwi.checkUpdate",
  "kiwi.chooseFolder",
  "kiwi.contextLine",
  "kiwi.createPerson",
  "kiwi.daemonAdopt",
  "kiwi.daemonStatus",
  "kiwi.devSignIn",
  "kiwi.doctor",
  "kiwi.foldersOn",
  "kiwi.getAccentColor",
  "kiwi.getDeepLink",
  "kiwi.getSnapshot",
  "kiwi.getToken",
  "kiwi.getUpdate",
  "kiwi.githubLink",
  "kiwi.githubPicture",
  "kiwi.githubRepos",
  "kiwi.githubStatus",
  "kiwi.githubUnlink",
  "kiwi.harnesses",
  "kiwi.harnessesOn",
  "kiwi.hooks",
  "kiwi.installCli",
  "kiwi.installUpdate",
  "kiwi.keysAtRest",
  "kiwi.launchAgent",
  "kiwi.launchRoots",
  "kiwi.linkAnswer",
  "kiwi.linkBegin",
  "kiwi.linkCancel",
  "kiwi.linkPoll",
  "kiwi.machines",
  "kiwi.migrateChannels",
  "kiwi.notify",
  "kiwi.onAccent",
  "kiwi.onDeepLink",
  "kiwi.onFrost",
  "kiwi.onGithubCode",
  "kiwi.onStore",
  "kiwi.onTextStep",
  "kiwi.onUpdate",
  "kiwi.openExternal",
  "kiwi.pairAnswer",
  "kiwi.pairBegin",
  "kiwi.pairCancel",
  "kiwi.pairPoll",
  "kiwi.relayUrl",
  "kiwi.saveChannels",
  "kiwi.saveComputers",
  "kiwi.seatFolders",
  "kiwi.seatPlaces",
  "kiwi.setAppearance",
  "kiwi.setBadge",
  "kiwi.setContextLine",
  "kiwi.setHooks",
  "kiwi.setLaunchRoot",
  "kiwi.setLaunches",
  "kiwi.setPending",
  "kiwi.setPersonalities",
  "kiwi.setRelayUrl",
  "kiwi.setRemoteBypass",
  "kiwi.setWake",
  "kiwi.settingsOn",
  "kiwi.showSeat",
  "kiwi.signIn",
  "kiwi.signOut",
  "kiwi.takeDroppedFiles",
  "kiwi.takePastedImage",
  "kiwi.terminalHelpers",
  "kiwi.terminalPrefer",
  "kiwi.terminals",
  "kiwi.uiError",
  "kiwi.uiReady",
  "kiwi.wakeSeats",
  "kiwi.wallpaperBackdrop",
  "kiwi.wallpaperTints",
  "kiwi.windowControl",
  "push:accent",
  "push:deepLink",
  "push:frost",
  "push:githubCode",
  "push:store",
  "push:textStep",
  "push:update",
];

export const UI_SURFACE_DELTAS: readonly (readonly [string, SurfaceDelta])[] = [
  ["1.1.0", { add: ["kiwi.applyUi", "kiwi.getUiUpdate", "kiwi.onUiUpdate", "push:uiUpdate"], remove: [] }],
  ["1.2.0", { add: ["kiwi.forgetPhone", "kiwi.saveFile"], remove: [] }],
  ["1.3.0", { add: ["kiwi.enrollAnswer", "kiwi.enrollConfirm", "kiwi.enrollDeny", "kiwi.enrollPoll"], remove: [] }],
  ["1.4.0", { add: ["kiwi.devices", "kiwi.forgetDevice", "kiwi.renewDevice"], remove: [] }],
  ["1.5.0", { add: ["kiwi.enrollBegin", "kiwi.enrollCancel", "kiwi.enrollStatus"], remove: [] }],
  ["1.6.0", { add: ["kiwi.onTerm", "kiwi.termClose", "kiwi.termKeys", "kiwi.termOpen", "kiwi.termSize", "push:term"], remove: [] }],
  ["1.7.0", { add: ["kiwi.deviceNews"], remove: [] }],
  ["1.8.0", { add: ["kiwi.compressImage"], remove: [] }],
  ["1.9.0", { add: ["kiwi.termMine", "kiwi.termTabClose", "kiwi.termTabs"], remove: [] }],
  ["1.10.0", { add: ["kiwi.enrollKeep"], remove: [] }],
  ["1.11.0", { add: ["kiwi.capabilities"], remove: [] }],
  ["1.12.0", { add: [], remove: [] }],
  ["1.13.0", { add: ["kiwi.recover", "kiwi.recoverCancel", "kiwi.recoverFinish", "kiwi.recovery", "kiwi.recoveryDrop", "kiwi.recoverySave", "kiwi.recoveryWords"], remove: [] }],
  ["1.14.0", { add: ["kiwi.recoveryCancel"], remove: [] }],
  ["1.15.0", { add: [], remove: [] }],
  ["1.16.0", { add: ["kiwi.dismissMovedApp", "kiwi.movedApp"], remove: [] }],
  ["1.17.0", { add: [], remove: [] }],
  ["1.18.0", { add: ["kiwi.proveSeat"], remove: [] }],
  ["1.19.0", { add: ["kiwi.reroot", "kiwi.rerootCancel", "kiwi.rerootFinish"], remove: [] }],
  ["1.20.0", { add: ["kiwi.keepAgents"], remove: [] }],
  ["1.21.0", { add: ["kiwi.termRemote", "kiwi.termRemoteClose", "kiwi.termRemoteTabs"], remove: [] }],
  [
    "2.0.0",
    {
      add: [],
      remove: [
        "kiwi.chooseFolder",
        "kiwi.foldersOn",
        "kiwi.harnessesOn",
        "kiwi.launchAgent",
        "kiwi.launchRoots",
        "kiwi.notify",
        "kiwi.onTerm",
        "kiwi.proveSeat",
        "kiwi.recover",
        "kiwi.recoverCancel",
        "kiwi.recoverFinish",
        "kiwi.recovery",
        "kiwi.recoveryCancel",
        "kiwi.recoveryDrop",
        "kiwi.recoverySave",
        "kiwi.recoveryWords",
        "kiwi.reroot",
        "kiwi.rerootCancel",
        "kiwi.rerootFinish",
        "kiwi.seatFolders",
        "kiwi.setLaunchRoot",
        "kiwi.setLaunches",
        "kiwi.setRemoteBypass",
        "kiwi.termClose",
        "kiwi.termKeys",
        "kiwi.termMine",
        "kiwi.termOpen",
        "kiwi.termRemote",
        "kiwi.termRemoteClose",
        "kiwi.termRemoteTabs",
        "kiwi.termSize",
        "kiwi.termTabClose",
        "kiwi.termTabs",
        "kiwi.terminalPrefer",
        "push:term",
      ],
    },
  ],
  ["3.0.0", { add: [], remove: ["kiwi.seatPlaces", "kiwi.showSeat", "kiwi.terminalHelpers", "kiwi.terminals"] }],
  ["3.1.0", { add: [], remove: [] }],
  ["3.2.0", { add: [], remove: [] }],
  ["3.3.0", { add: ["kiwi.onCommand", "push:command"], remove: [] }],
  ["3.4.0", { add: ["kiwi.sharedSeats"], remove: [] }],
  ["3.5.0", { add: ["kiwi.copyText"], remove: [] }],
  ["3.6.0", { add: [], remove: [] }],
  ["3.7.0", { add: ["kiwi.onMaximized", "kiwi.windowMaximized", "push:maximized"], remove: [] }],
];

export function buildSurfaces(firstVersion: string, firstSurfaces: readonly string[], deltas: readonly (readonly [string, SurfaceDelta])[]): Record<string, readonly string[]> {
  const history: Record<string, readonly string[]> = { [firstVersion]: [...firstSurfaces].sort() };
  let current = new Set(firstSurfaces);
  if (current.size !== firstSurfaces.length) throw new Error(`UI contract ${firstVersion} lists a surface twice`);
  for (const [version, { add, remove }] of deltas) {
    if (version in history) throw new Error(`UI contract ${version} is listed twice`);
    const next = new Set(current);
    for (const name of remove) if (!next.delete(name)) throw new Error(`UI contract ${version} removes ${name}, which the previous version doesn't list`);
    for (const name of add) {
      if (next.has(name)) throw new Error(`UI contract ${version} adds ${name}, which is already listed`);
      next.add(name);
    }
    history[version] = [...next].sort();
    current = next;
  }
  return history;
}

export const UI_SURFACES: Readonly<Record<string, readonly string[]>> = buildSurfaces(UI_FIRST_CONTRACT, UI_FIRST_SURFACES, UI_SURFACE_DELTAS);

import type { KeysPort, KiwiBridge, StoreSnapshot, TermEvent, UiUpdateView, UpdateView } from "./bridge.ts";
import type { TextStep } from "./text-size.ts";

export type Call = { [K in keyof KiwiBridge]: KiwiBridge[K] extends (...args: never[]) => Promise<unknown> ? K : never }[keyof KiwiBridge];
export type CallArgs<K extends Call> = KiwiBridge[K] extends (...args: infer A) => Promise<unknown> ? A : never;
export type CallValue<K extends Call> = KiwiBridge[K] extends (...args: never[]) => Promise<infer V> ? V : never;

export type Handlers = { [K in Call]: (...args: CallArgs<K>) => CallValue<K> | Promise<CallValue<K>> };
export type Serves<K extends Call> = Pick<Handlers, K>;

export interface Pushes {
  store: StoreSnapshot;
  update: UpdateView;
  githubCode: { code: string; url: string };
  deepLink: string;
  textStep: TextStep;
  frost: boolean;
  accent: string | null;
  uiUpdate: UiUpdateView | null;
  term: TermEvent;
}

export type Push = keyof Pushes;

export interface BridgeTransport {
  readonly snapshot: StoreSnapshot;
  readonly channels: KeysPort;
  call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>>;
  listen<P extends Push>(name: P, cb: (value: Pushes[P]) => void): () => void;
}

export function makeBridge(t: BridgeTransport): KiwiBridge {
  let latest = t.snapshot;
  t.listen("store", (s) => (latest = s));
  return {
    relayUrl: latest.relayUrl,
    getSnapshot: () => latest,
    onStore: (cb) => t.listen("store", cb),
    setRelayUrl: (url) => t.call("setRelayUrl", url),
    createPerson: (name) => t.call("createPerson", name),
    saveChannels: (list) => t.call("saveChannels", list),
    migrateChannels: (entries) => t.call("migrateChannels", entries),
    channels: t.channels,
    saveComputers: (computers) => t.call("saveComputers", computers),
    setPending: (pending) => t.call("setPending", pending),
    signIn: () => t.call("signIn"),
    devSignIn: (name) => t.call("devSignIn", name),
    getToken: () => t.call("getToken"),
    signOut: () => t.call("signOut"),
    githubStatus: () => t.call("githubStatus"),
    githubLink: () => t.call("githubLink"),
    githubUnlink: () => t.call("githubUnlink"),
    githubRepos: () => t.call("githubRepos"),
    githubPicture: () => t.call("githubPicture"),
    onGithubCode: (cb) => t.listen("githubCode", cb),
    pairBegin: () => t.call("pairBegin"),
    pairPoll: () => t.call("pairPoll"),
    pairCancel: () => t.call("pairCancel"),
    pairAnswer: (accept) => t.call("pairAnswer", accept),
    linkBegin: () => t.call("linkBegin"),
    linkPoll: () => t.call("linkPoll"),
    linkAnswer: (accept) => t.call("linkAnswer", accept),
    linkCancel: () => t.call("linkCancel"),
    forgetPhone: (at) => t.call("forgetPhone", at),
    enrollPoll: () => t.call("enrollPoll"),
    enrollAnswer: (id) => t.call("enrollAnswer", id),
    enrollConfirm: (id, digits) => t.call("enrollConfirm", id, digits),
    enrollDeny: (id) => t.call("enrollDeny", id),
    enrollBegin: () => t.call("enrollBegin"),
    enrollStatus: () => t.call("enrollStatus"),
    enrollKeep: () => t.call("enrollKeep"),
    enrollCancel: () => t.call("enrollCancel"),
    devices: () => t.call("devices"),
    forgetDevice: (id) => t.call("forgetDevice", id),
    renewDevice: (id) => t.call("renewDevice", id),
    deviceNews: () => t.call("deviceNews"),
    recovery: () => t.call("recovery"),
    recoveryWords: () => t.call("recoveryWords"),
    recoverySave: (typed) => t.call("recoverySave", typed),
    recoveryDrop: () => t.call("recoveryDrop"),
    daemonStatus: () => t.call("daemonStatus"),
    doctor: () => t.call("doctor"),
    daemonAdopt: () => t.call("daemonAdopt"),
    installCli: () => t.call("installCli"),
    keysAtRest: () => t.call("keysAtRest"),
    wallpaperTints: (dark) => t.call("wallpaperTints", dark),
    wallpaperBackdrop: (dark) => t.call("wallpaperBackdrop", dark),
    windowControl: (action) => t.call("windowControl", action),
    getUpdate: () => t.call("getUpdate"),
    onUpdate: (cb) => t.listen("update", cb),
    installUpdate: () => t.call("installUpdate"),
    checkUpdate: () => t.call("checkUpdate"),
    notify: (title, body, link) => t.call("notify", title, body, link),
    openExternal: (url) => t.call("openExternal", url),
    saveFile: (name, text) => t.call("saveFile", name, text),
    getDeepLink: () => t.call("getDeepLink"),
    takeDroppedFiles: () => t.call("takeDroppedFiles"),
    takePastedImage: () => t.call("takePastedImage"),
    compressImage: (data, limit) => t.call("compressImage", data, limit),
    setBadge: (count) => t.call("setBadge", count),
    setAppearance: (appearance) => t.call("setAppearance", appearance),
    uiReady: () => t.call("uiReady"),
    uiError: (message) => t.call("uiError", message),
    getUiUpdate: () => t.call("getUiUpdate"),
    onUiUpdate: (cb) => t.listen("uiUpdate", cb),
    applyUi: () => t.call("applyUi"),
    onDeepLink: (cb) => t.listen("deepLink", cb),
    onTextStep: (cb) => t.listen("textStep", cb),
    onFrost: (cb) => t.listen("frost", cb),
    getAccentColor: () => t.call("getAccentColor"),
    capabilities: () => t.call("capabilities"),
    onAccent: (cb) => t.listen("accent", cb),
    setPersonalities: (list) => t.call("setPersonalities", list),
    seatPlaces: () => t.call("seatPlaces"),
    showSeat: (seat) => t.call("showSeat", seat),
    termOpen: (pane, cols, rows) => t.call("termOpen", pane, cols, rows),
    termMine: (roomId, want, cols, rows) => t.call("termMine", roomId, want, cols, rows),
    termTabs: () => t.call("termTabs"),
    termTabClose: (pane) => t.call("termTabClose", pane),
    termKeys: (term, keys) => t.call("termKeys", term, keys),
    termSize: (term, cols, rows) => t.call("termSize", term, cols, rows),
    termClose: (term) => t.call("termClose", term),
    onTerm: (cb) => t.listen("term", cb),
    terminals: () => t.call("terminals"),
    terminalHelpers: (id, to) => t.call("terminalHelpers", id, to),
    terminalPrefer: (id) => t.call("terminalPrefer", id),
    setLaunches: (to) => t.call("setLaunches", to),
    setRemoteBypass: (to) => t.call("setRemoteBypass", to),
    contextLine: () => t.call("contextLine"),
    setContextLine: (to) => t.call("setContextLine", to),
    hooks: () => t.call("hooks"),
    setHooks: (harness, to) => t.call("setHooks", harness, to),
    wakeSeats: () => t.call("wakeSeats"),
    setWake: (room, agent, to) => t.call("setWake", room, agent, to),
    harnesses: () => t.call("harnesses"),
    seatFolders: (roomId) => t.call("seatFolders", roomId),
    chooseFolder: () => t.call("chooseFolder"),
    launchAgent: (req) => t.call("launchAgent", req),
    machines: () => t.call("machines"),
    harnessesOn: (machinePk) => t.call("harnessesOn", machinePk),
    foldersOn: (machinePk, roomId) => t.call("foldersOn", machinePk, roomId),
    settingsOn: (machinePk) => t.call("settingsOn", machinePk),
    launchRoots: () => t.call("launchRoots"),
    setLaunchRoot: (dir, to) => t.call("setLaunchRoot", dir, to),
  };
}

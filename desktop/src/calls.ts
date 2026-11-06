import type { FolderThemesView, KeyBindingsView, KeysPort, KiwiBridge, LayoutsView, ModView, StoreSnapshot, UiUpdateView, UpdateView } from "./bridge.ts";
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
  folderThemes: FolderThemesView;
  keyBindings: KeyBindingsView;
  layouts: LayoutsView;
  mods: ModView[];
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
    keepAgents: (code, agents) => t.call("keepAgents", code, agents),
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
    movedApp: () => t.call("movedApp"),
    dismissMovedApp: () => t.call("dismissMovedApp"),
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
    mods: () => t.call("mods"),
    onMods: (cb) => t.listen("mods", cb),
    modBundle: (name) => t.call("modBundle", name),
    approveMod: (name, needs) => t.call("approveMod", name, needs),
    modFetch: (name, req) => t.call("modFetch", name, req),
    modFailed: (name, hash, why) => t.call("modFailed", name, hash, why),
    setModOn: (name, on) => t.call("setModOn", name, on),
    modsSettled: () => t.call("modsSettled"),
    modIcon: (name) => t.call("modIcon", name),
    modDetails: (name) => t.call("modDetails", name),
    modsInstalled: () => t.call("modsInstalled"),
    modUpdates: () => t.call("modUpdates"),
    updateMod: (name) => t.call("updateMod", name),
    removeMod: (name, force) => t.call("removeMod", name, force),
    onAccent: (cb) => t.listen("accent", cb),
    folderThemes: () => t.call("folderThemes"),
    onFolderThemes: (cb) => t.listen("folderThemes", cb),
    saveFolderTheme: (file, theme) => t.call("saveFolderTheme", file, theme),
    deleteFolderTheme: (file) => t.call("deleteFolderTheme", file),
    keyBindings: () => t.call("keyBindings"),
    onKeyBindings: (cb) => t.listen("keyBindings", cb),
    layouts: () => t.call("layouts"),
    onLayouts: (cb) => t.listen("layouts", cb),
    setPersonalities: (list) => t.call("setPersonalities", list),
    contextLine: () => t.call("contextLine"),
    setContextLine: (to) => t.call("setContextLine", to),
    hooks: () => t.call("hooks"),
    setHooks: (harness, to) => t.call("setHooks", harness, to),
    wakeSeats: () => t.call("wakeSeats"),
    setWake: (room, agent, to) => t.call("setWake", room, agent, to),
    harnesses: () => t.call("harnesses"),
    machines: () => t.call("machines"),
    settingsOn: (machinePk) => t.call("settingsOn", machinePk),
  };
}

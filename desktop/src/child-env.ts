const KEPT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "SSH_AUTH_SOCK",
  "__CF_USER_TEXT_ENCODING",
  "XPC_SERVICE_NAME",
  "XPC_FLAGS",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "DESKTOP_SESSION",
  "KDE_FULL_SESSION",
  "KDE_SESSION_VERSION",
  "GNOME_DESKTOP_SESSION_ID",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
]);
const KEPT_PREFIXES = ["LC_", "XDG_", "KIWI_"];
const RUNTIME = /^(LD_.*|DYLD_.*|BUN_.*|NODE_OPTIONS|KIWI_KEY_FD)$/;

const defined = (from: NodeJS.ProcessEnv, keep: (name: string) => boolean): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(from).filter(([name, value]) => value !== undefined && keep(name.toUpperCase())));

export function childEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return defined(from, (name) => !RUNTIME.test(name) && (KEPT.has(name) || KEPT_PREFIXES.some((p) => name.startsWith(p))));
}

export function sessionEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return defined(from, (name) => !RUNTIME.test(name));
}

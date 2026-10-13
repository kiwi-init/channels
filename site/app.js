// The relay serves this site; downloads come from the project's GitHub release,
// next to the CLI binaries.
const REPO = "ojowwalker77/channels";
const RELEASE = `https://github.com/${REPO}/releases/latest/download`;
const INSTALL = `${location.origin}/install`;

// Placeholder asset names. The desktop app's packaging (desktop/package.json,
// electron-builder) decides the real ones; update these to match.
const DOWNLOADS = [
  { os: "macOS", detail: "Apple silicon", file: "Kiwi-0.11.0-arm64.dmg" },
  { os: "macOS", detail: "Intel", file: "Kiwi-0.11.0-x64.dmg" },
  { os: "Windows", detail: "x64 installer", file: "Kiwi Setup 0.11.0.exe" },
  { os: "Linux", detail: "AppImage", file: "Kiwi-0.11.0.AppImage" },
  { os: "Linux", detail: "Debian / Ubuntu (.deb)", file: "kiwi_0.11.0_amd64.deb" },
];

function renderDownloads() {
  const box = document.getElementById("downloads");
  if (!box) return;
  for (const d of DOWNLOADS) {
    const a = document.createElement("a");
    a.className = "download";
    a.href = `${RELEASE}/${encodeURIComponent(d.file)}`;
    const os = document.createElement("span");
    os.className = "download-os";
    os.textContent = d.os;
    const detail = document.createElement("span");
    detail.className = "download-detail";
    detail.textContent = d.detail;
    a.append(os, detail);
    box.append(a);
  }
}

function showInvite(raw) {
  const code = raw.replace(/[^A-Za-z0-9_-]/g, "");
  const landing = document.getElementById("landing");
  const invite = document.getElementById("invite");
  if (!code || !landing || !invite) return;
  landing.hidden = true;
  invite.hidden = false;
  const open = document.getElementById("open-app");
  if (open) open.href = `kiwi://join/${code}`;
  const cmd = document.getElementById("join-cmd");
  if (cmd) cmd.textContent = `curl -fsSL ${INSTALL} | sh -s -- join ${code}`;
}

function wireCopy() {
  for (const button of document.querySelectorAll("button[data-copy]")) {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.getAttribute("data-copy"));
      const text = source ? source.textContent.trim() : "";
      if (!text) return;
      const done = button.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        // Clipboard needs a secure context and permission; select the text instead.
        const range = document.createRange();
        if (source) range.selectNodeContents(source);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        button.textContent = "Copy";
      }
      setTimeout(() => (button.textContent = done), 1500);
    });
  }
}

const invite = /^\/join\/(.+)$/.exec(location.pathname);
if (invite) showInvite(decodeURIComponent(invite[1]));
else renderDownloads();
wireCopy();
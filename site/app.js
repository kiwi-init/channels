// The relay serves this site; downloads come from the project's GitHub release,
// next to the CLI binaries.
const REPO = "ojowwalker77/channels";
const RELEASE = `https://github.com/${REPO}/releases/latest/download`;
const INSTALL = `${location.origin}/install`;

const DOWNLOADS = [
  { os: "macOS", detail: "Apple silicon", file: "Channels-0.16.2-mac-arm64.dmg" },
  { os: "macOS", detail: "Intel", file: "Channels-0.16.2-mac-x64.dmg" },
  { os: "Linux", detail: "AppImage", file: "Channels-0.16.2-linux-x86_64.AppImage" },
  { os: "Linux", detail: "Debian / Ubuntu (.deb)", file: "Channels-0.16.2-linux-amd64.deb" },
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

function showInvite(code) {
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

// The renderer's invite link is `<relay>/#<code>`; `/join/<code>` also works.
function inviteCode() {
  const fromPath = /^\/join\/(mc2-[A-Za-z0-9_-]+)\/?$/.exec(location.pathname);
  if (fromPath) return fromPath[1];
  const hash = location.hash.replace(/^#/, "").trim();
  return /^mc2-[A-Za-z0-9_-]+$/.test(hash) ? hash : "";
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

const code = inviteCode();
if (code) showInvite(code);
else renderDownloads();
wireCopy();
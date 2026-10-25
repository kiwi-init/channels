import hashlib
import os
import socket
import subprocess
import sys
from pathlib import Path

PASSWORD = b"throwaway"
SALT_BYTES = 56
KEY_BYTES = 56
ITERATIONS = 50000
PASSED = ("DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP", "KDE_FULL_SESSION", "KDE_SESSION_VERSION", "HOME", "USER", "LANG")


def main() -> None:
    daemon, log = sys.argv[1], sys.argv[2]
    salt_file = Path.home() / ".local/share/kwalletd/kdewallet.salt"
    salt_file.parent.mkdir(parents=True, exist_ok=True)
    salt = os.urandom(SALT_BYTES)
    salt_file.write_bytes(salt)
    salt_file.chmod(0o600)
    key = hashlib.pbkdf2_hmac("sha512", PASSWORD, salt, ITERATIONS, KEY_BYTES)

    path = os.path.join(os.environ["XDG_RUNTIME_DIR"], "kwallet5.socket")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(5)
    read_end, write_end = os.pipe()
    env = dict(os.environ, PAM_KWALLET5_LOGIN=path, QT_QPA_PLATFORM="offscreen")
    with open(log, "wb") as out:
        subprocess.Popen([daemon, "--pam-login", str(read_end), str(listener.fileno())], pass_fds=(read_end, listener.fileno()), env=env, stdout=out, stderr=subprocess.STDOUT)
    os.close(read_end)
    listener.close()
    os.write(write_end, key)
    os.close(write_end)

    lines = "".join(f"{name}={os.environ[name]}\n" for name in PASSED if name in os.environ)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.connect(path)
        conn.sendall(lines.encode())


main()

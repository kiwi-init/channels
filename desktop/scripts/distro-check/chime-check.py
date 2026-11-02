import base64
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2

PAGES = {
    "element": "new Audio(URL.createObjectURL(new Blob([WAV], { type: 'audio/wav' }))).play()"
    ".then(() => setTimeout(() => say('played'), 2000), (e) => say('refused: ' + e))",
    "webaudio": "(async () => { const context = new AudioContext(); const buffer = await context.decodeAudioData(WAV.buffer.slice(0));"
    " await context.resume(); const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();"
    " setTimeout(() => say('played, ' + context.state), 2000) })().catch((e) => say('silent: ' + e))",
}


def main(wav_path: str, mode: str) -> str:
    outcome = ["no answer in 20 s"]

    def finish(text: str) -> None:
        outcome[0] = text
        Gtk.main_quit()

    def ended(_view: WebKit2.WebView, reason: WebKit2.WebProcessTerminationReason) -> None:
        finish(f"the web process ended: {reason.value_nick}")

    def said(_manager: WebKit2.UserContentManager, message: WebKit2.JavascriptResult) -> None:
        finish(f"the page said: {message.get_js_value().to_string()}")

    def timed_out() -> bool:
        finish(outcome[0])
        return False

    with open(wav_path, "rb") as f:
        wav = base64.b64encode(f.read()).decode()
    view = WebKit2.WebView(website_policies=WebKit2.WebsitePolicies(autoplay=WebKit2.AutoplayPolicy.ALLOW))
    view.connect("web-process-terminated", ended)
    manager = view.get_user_content_manager()
    manager.register_script_message_handler("chime")
    manager.connect("script-message-received::chime", said)
    script = f"const WAV = Uint8Array.from(atob('{wav}'), (c) => c.charCodeAt(0)); const say = (t) => webkit.messageHandlers.chime.postMessage(t);"
    window = Gtk.Window()
    window.add(view)
    window.show_all()
    view.load_html(f"<script>{script}\n{PAGES[mode]}</script>", "https://chime.invalid/")
    GLib.timeout_add_seconds(20, timed_out)
    Gtk.main()
    return outcome[0]


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in PAGES:
        print(f"usage: chime-check.py WAV {'|'.join(PAGES)}", file=sys.stderr)
        sys.exit(2)
    print(main(sys.argv[1], sys.argv[2]))

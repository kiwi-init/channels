export const WHISPER_MODEL = "whisper-base";

const WHISPER_REPO = "onnx-community/whisper-base";
const WHISPER_REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925";
const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
export const ORT_WASM = "ort-wasm-simd-threaded.asyncify.wasm";

export interface DictationFile {
  url: string;
  sha256: string;
  size: number;
}

const hub = (file: string) => `https://huggingface.co/${WHISPER_REPO}/resolve/${WHISPER_REVISION}/${file}`;

export const DICTATION_FILES: Readonly<Record<string, DictationFile>> = {
  [`${WHISPER_MODEL}/config.json`]: { url: hub("config.json"), sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b", size: 2243 },
  [`${WHISPER_MODEL}/generation_config.json`]: { url: hub("generation_config.json"), sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0", size: 3832 },
  [`${WHISPER_MODEL}/preprocessor_config.json`]: { url: hub("preprocessor_config.json"), sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d", size: 339 },
  [`${WHISPER_MODEL}/tokenizer.json`]: { url: hub("tokenizer.json"), sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566", size: 2480466 },
  [`${WHISPER_MODEL}/tokenizer_config.json`]: { url: hub("tokenizer_config.json"), sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573", size: 282682 },
  [`${WHISPER_MODEL}/onnx/encoder_model_quantized.onnx`]: {
    url: hub("onnx/encoder_model_quantized.onnx"),
    sha256: "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46",
    size: 23201314,
  },
  [`${WHISPER_MODEL}/onnx/decoder_model_merged_quantized.onnx`]: {
    url: hub("onnx/decoder_model_merged_quantized.onnx"),
    sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b",
    size: 53693315,
  },
  [`ort/${ORT_WASM}`]: {
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${ORT_WASM}`,
    sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082",
    size: 26861777,
  },
};

export const DICTATION_PATH = "/v1/dictation/";

export const DICTATION_BYTES = Object.values(DICTATION_FILES).reduce((n, f) => n + f.size, 0);

export function dictationFile(name: string): DictationFile | null {
  return Object.hasOwn(DICTATION_FILES, name) ? DICTATION_FILES[name]! : null;
}

export interface Hasher {
  update(chunk: Uint8Array): void | Promise<void>;
  hex(): Promise<string>;
}

export function hexOf(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return hexOf(await crypto.subtle.digest("SHA-256", bytes));
}

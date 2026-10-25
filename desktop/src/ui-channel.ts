export const UI_RELEASE_TAG = "livewire-ui";

export const UI_MANIFEST_URL = `https://github.com/kiwi-init/channels/releases/download/${UI_RELEASE_TAG}/manifest.json`;

export const UI_TRUSTED_KEYS: Readonly<Record<string, string>> = { "1e3ce6be9ab0ba18": "SHrbT-lM_brKgMTjoY2v4LO5RyKckpefCMBp7E5kY-A" };

export const UI_PREFIX = "internal";

export const UI_READY_MS = 20_000;

export const UI_POLL_MS = 30 * 60_000;

import { LIVEWIRE_NAME } from "./livewire-id.ts";

declare const KIWI_EB_LIVEWIRE: boolean;

export const APP_NAME: string = KIWI_EB_LIVEWIRE ? LIVEWIRE_NAME : "Channels";

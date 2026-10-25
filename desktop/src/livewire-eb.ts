import os from "node:os";

import { livewireKiwiEnv } from "./livewire-home.ts";

declare const KIWI_EB_TEST: boolean;

Object.assign(process.env, livewireKiwiEnv(process.env, os.homedir(), KIWI_EB_TEST));

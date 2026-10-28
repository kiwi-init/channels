import type { Delivery } from "../agent/shared.ts";

export const LOOP_ENV = "KIWI_LOOP";

export const loopDelivery = (): Delivery => (process.env[LOOP_ENV] === "1" ? { loop: true } : {});

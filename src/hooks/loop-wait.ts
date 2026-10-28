import * as Effect from "effect/Effect";
import type { AgentSession } from "../agent.ts";
import type { Delivery } from "../agent/shared.ts";
import { waitingFor } from "../agent/wants.ts";

export const LOOP_ENV = "KIWI_LOOP";

export const loopDelivery = (s: AgentSession) => (process.env[LOOP_ENV] === "1" ? Effect.map(s.state(), ({ state }): Delivery => waitingFor(state, s.me)) : Effect.succeed<Delivery>({}));

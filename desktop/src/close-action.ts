import { tiles } from "./compositor.ts";

export const closeAction = (trayHost: boolean, env: NodeJS.ProcessEnv): "hide" | "minimize" => (trayHost || tiles(env) ? "hide" : "minimize");

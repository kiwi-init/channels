import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { rexBinary } from "./rex.ts";

const REQUIRE = 'require("kiwi")';
const MARK = "-- Kiwi: go to the seat that needs me";
const LINE = `${REQUIRE} ${MARK}`;
const NAME = "kiwi.lua";
const FIND_NAME = "kiwi-find.lua";

const FIND = `local terminal = "com.superlogical.terminal"
local found = {}
local listed = rex.call("session.list", {})
for _, session in ipairs(type(listed) == "table" and listed.sessions or {}) do
  local id = session.session_id
  if rex.session.attach{ session_id = id } ~= nil then
    local blocks = rex.call("session.list_blocks", { session_id = id })
    for _, block in ipairs(type(blocks) == "table" and blocks.blocks or {}) do
      if block.placement == "placed" then
        local status = rex.block.call(terminal, "program_status", { session_id = id, block_id = block.block_id })
        for _, record in ipairs(type(status) == "table" and status.records or {}) do
          local state = record.state
          if record.app == "kiwi" and (state == "blocked" or state == "done") then
            local at = tostring(record.updated_at or "")
            local held = found[state]
            if held == nil or at < held.at then found[state] = { session_id = id, block_id = block.block_id, at = at } end
          end
        end
      end
    end
    rex.session.detach{ session_id = id }
  end
end
local row = found.blocked or found.done
if row == nil then return { found = false } end
if rex.session.attach{ session_id = row.session_id } == nil then error("Kiwi couldn't reach that seat's session", 0) end
local _, err = rex.call("session.focus_block", { session_id = row.session_id, block_id = row.block_id })
if err ~= nil then error(err, 0) end
return { found = true, session_id = row.session_id, block_id = row.block_id }
`;

function actionLua(find: string, bin: string): string {
  return `local rex_bin = ${JSON.stringify(bin)}
local find = ${JSON.stringify(find)}

rex.action{
  name = "kiwi_needs_you",
  title = "Kiwi: Go to the seat that needs me",
  description = "Focus the seat with a question open to a person, else the one with a task waiting for review.",
  category = "Kiwi",
  keywords = "kiwi channels needs you seat question review",
  run = function(ctx)
    local ran, err = rex.exec({ rex_bin, "do", find }, { timeout = 10 })
    if ran == nil then error(err, 0) end
    if not ran.ok then error(ran.stderr ~= "" and ran.stderr or "Kiwi couldn't look for the seat", 0) end
    local row = rex.json.decode(ran.stdout)
    if type(row) ~= "table" or not row.found then return nil end
    if row.session_id ~= ctx.session_id then rex.client.queue("session.select", { session_id = row.session_id }) end
    return { session_id = row.session_id, block_id = row.block_id }
  end,
}
`;
}

export function rexConfigPath(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  const explicit = env.REX_CONFIG?.trim();
  if (explicit) return explicit;
  if (process.platform === "win32") return join(env.APPDATA?.trim() || join(home, "AppData", "Roaming"), "rex", "init.lua");
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "rex", "init.lua");
}

function palettePath(init = rexConfigPath()): string {
  return join(dirname(init), NAME);
}

function findPath(init = rexConfigPath()): string {
  return join(dirname(init), FIND_NAME);
}

function carries(action: string): boolean {
  return action.split("\n").some((line) => line.trim() === LINE);
}

export function paletteInstalled(init = rexConfigPath()): boolean {
  if (!existsSync(palettePath(init)) || !existsSync(findPath(init)) || !existsSync(init)) return false;
  return carries(readFileSync(init, "utf8"));
}

function put(file: string, text: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  writeFileSync(file, text, { mode: 0o600 });
  return true;
}

export function replaceFile(file: string, text: string): void {
  const target = existsSync(file) ? realpathSync(file) : file;
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
  const tmp = `${target}.kiwi-${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, target);
}

export function installPalette(init = rexConfigPath(), bin = rexBinary() ?? "rex"): { action: string; init: string; changed: boolean } {
  const action = palettePath(init);
  const find = findPath(init);
  mkdirSync(dirname(init), { recursive: true, mode: 0o700 });
  const wrote = [put(find, FIND), put(action, actionLua(find, bin))].some(Boolean);
  const before = existsSync(init) ? readFileSync(init, "utf8") : "";
  if (carries(before)) return { action, init, changed: wrote };
  const next = before && !before.endsWith("\n") ? `${before}\n${LINE}\n` : `${before}${LINE}\n`;
  replaceFile(init, next);
  return { action, init, changed: true };
}

export function removePalette(init = rexConfigPath()): boolean {
  let changed = false;
  for (const file of [palettePath(init), findPath(init)]) {
    if (!existsSync(file)) continue;
    rmSync(file, { force: true });
    changed = true;
  }
  if (existsSync(init)) {
    const before = readFileSync(init, "utf8");
    const after = before
      .split("\n")
      .filter((line) => line.trim() !== LINE)
      .join("\n");
    if (after !== before) {
      replaceFile(init, after);
      changed = true;
    }
  }
  return changed;
}

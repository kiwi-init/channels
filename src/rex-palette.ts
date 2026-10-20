import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REQUIRE = 'require("kiwi")';
const MARK = "-- Kiwi: go to the seat that needs me";
const LINE = `${REQUIRE} ${MARK}`;
const NAME = "kiwi.lua";

const ACTION = `local function kiwi_list(value, keys)
  if type(value) ~= "table" then return {} end
  local out = {}
  for _, key in ipairs(keys) do
    local list = value[key]
    if type(list) == "table" then
      for _, item in pairs(list) do table.insert(out, item) end
    end
  end
  if #out == 0 and #value > 0 then return value end
  return out
end

local function kiwi_id(item)
  if type(item) == "string" then return item end
  if type(item) == "table" then return item.block_id or item.session_id or item.id end
  return nil
end

local function kiwi_sessions()
  local listed = rex.call("session.list") or {}
  return kiwi_list(listed, { "sessions", "values", "list" })
end

local function kiwi_blocks(session_id)
  local got = rex.session.list_blocks{ session_id = session_id } or {}
  return kiwi_list(got, { "blocks", "placed", "detached", "values", "list" })
end

local function kiwi_records(block_id)
  local got = rex.block.call("com.superlogical.terminal", "program_status", { block_id = block_id }) or {}
  return kiwi_list(got, { "records", "status", "program_status", "values" })
end

local function kiwi_seats()
  local rows = {}
  local seen = {}
  for _, session in ipairs(kiwi_sessions()) do
    local session_id = session.session_id or session.id
    if session_id ~= nil then
      for _, block in ipairs(kiwi_blocks(session_id)) do
        local block_id = kiwi_id(block)
        if block_id ~= nil and not seen[block_id] then
          seen[block_id] = true
          table.insert(rows, { session_id = session_id, block_id = block_id })
        end
      end
    end
  end
  table.sort(rows, function(a, b) return tostring(a.block_id) < tostring(b.block_id) end)
  return rows
end

local function kiwi_needs()
  local rows = kiwi_seats()
  for _, state in ipairs({ "blocked", "done" }) do
    for _, row in ipairs(rows) do
      for _, record in ipairs(kiwi_records(row.block_id)) do
        if record.app == "kiwi" and record.state == state then return row end
      end
    end
  end
  return nil
end

rex.action{
  name = "kiwi_needs_you",
  title = "Kiwi: Go to the seat that needs me",
  description = "Focus the Kiwi seat with a question open to a person, or with a task waiting for review.",
  category = "Kiwi",
  keywords = { "kiwi", "channels", "needs you", "seat", "blocked", "review" },
  run = function()
    local row = kiwi_needs()
    if row == nil then return nil end
    local _, err = rex.session.focus_block{ session_id = row.session_id, block_id = row.block_id }
    if err ~= nil then error(err, 0) end
    return row
  end,
}
`;

export function rexConfigPath(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  const explicit = env.REX_CONFIG?.trim();
  if (explicit) return explicit;
  if (process.platform === "win32") return join(env.APPDATA?.trim() || join(home, "AppData", "Roaming"), "rex", "init.lua");
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "rex", "init.lua");
}

function palettePath(init = rexConfigPath()): string {
  return join(dirname(init), NAME);
}

function carries(action: string): boolean {
  return action.split("\n").some((line) => line.trim() === LINE);
}

export function paletteInstalled(init = rexConfigPath()): boolean {
  const action = palettePath(init);
  if (!existsSync(action)) return false;
  if (!existsSync(init)) return false;
  return readFileSync(init, "utf8").includes(LINE);
}

export function installPalette(init = rexConfigPath()): { action: string; init: string; changed: boolean } {
  const action = palettePath(init);
  mkdirSync(dirname(init), { recursive: true, mode: 0o700 });
  const was = existsSync(action) ? readFileSync(action, "utf8") : null;
  if (was !== ACTION) writeFileSync(action, ACTION, { mode: 0o600 });
  const before = existsSync(init) ? readFileSync(init, "utf8") : "";
  if (carries(before)) return { action, init, changed: was !== ACTION };
  const next = before && !before.endsWith("\n") ? `${before}\n${LINE}\n` : `${before}${LINE}\n`;
  writeFileSync(init, next, { mode: 0o600 });
  return { action, init, changed: true };
}

export function removePalette(init = rexConfigPath()): boolean {
  const action = palettePath(init);
  let changed = false;
  if (existsSync(action)) {
    rmSync(action, { force: true });
    changed = true;
  }
  if (existsSync(init)) {
    const before = readFileSync(init, "utf8");
    const after = before
      .split("\n")
      .filter((line) => line.trim() !== LINE)
      .join("\n");
    if (after !== before) {
      writeFileSync(init, after, { mode: 0o600 });
      changed = true;
    }
  }
  return changed;
}

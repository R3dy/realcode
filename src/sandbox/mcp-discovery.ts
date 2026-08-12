import * as fs from "fs";
import * as path from "path";

/**
 * discoverMcpPaths reads `${configDir}/opencode.json`, parses the top-level
 * `mcp` object, and returns the de-duplicated set of path-bearing `command`
 * entries (each MCP server's `command` may be a string OR an array of strings).
 *
 * Bare binary names (e.g. `"node"`, no `/`) are skipped — they resolve on PATH
 * inside the sandbox image or are fetched at runtime. Only path-bearing
 * commands are mountable.
 *
 * Returns `[]` when `opencode.json` is missing, unparseable, has no `mcp`
 * section, or no MCP server declares a path-bearing command.
 *
 * Established by: Story A4.3 (issue #4). See CONVENTIONS.md "Sandbox / Docker
 * Pattern" → "opencode-config inheritance + MCP discovery".
 */
export function discoverMcpPaths(configDir: string): string[] {
  const configPath = path.join(configDir, "opencode.json");
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const mcp = (parsed as { mcp?: Record<string, unknown> } | null)?.mcp;
  if (!mcp || typeof mcp !== "object") return [];

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const server of Object.values(mcp)) {
    if (!server || typeof server !== "object") continue;
    const command = (server as { command?: string | string[] }).command;
    if (command === undefined) continue;
    const cmds: string[] = Array.isArray(command) ? command : [command];
    for (const c of cmds) {
      if (typeof c !== "string") continue;
      // Only path-bearing commands are mountable — bare names like "node"
      // resolve on PATH inside the sandbox image (edge case, plan §4.6).
      if (!c.includes("/")) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      paths.push(c);
    }
  }
  return paths;
}

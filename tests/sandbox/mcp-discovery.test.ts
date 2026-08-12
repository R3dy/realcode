import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { discoverMcpPaths } from "../../src/sandbox/mcp-discovery.js";

describe("sandbox/mcp-discovery: discoverMcpPaths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-mcp-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns path-bearing command entries from the mcp section (string array form)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          realmemory: {
            command: ["node", "/home/royce/mission-control/PROJECTS/realmemory/repo/dist/bin.js"],
          },
          "codebase-memory-mcp": {
            command: ["/home/royce/.local/bin/codebase-memory-mcp"],
          },
        },
      }, null, 2),
    );
    const paths = discoverMcpPaths(tmpDir);
    expect(paths).toContain("/home/royce/mission-control/PROJECTS/realmemory/repo/dist/bin.js");
    expect(paths).toContain("/home/royce/.local/bin/codebase-memory-mcp");
    // Bare binary names (no /) are skipped — they resolve on PATH.
    expect(paths).not.toContain("node");
  });

  it("handles a command that is a bare string (not an array)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: { single: { command: "/abs/path/to/server.js" } },
      }, null, 2),
    );
    const paths = discoverMcpPaths(tmpDir);
    expect(paths).toEqual(["/abs/path/to/server.js"]);
  });

  it("returns [] when opencode.json has no mcp section (edge case)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ model: "x", provider: {} }, null, 2),
    );
    expect(discoverMcpPaths(tmpDir)).toEqual([]);
  });

  it("returns [] when opencode.json is missing", () => {
    expect(discoverMcpPaths(tmpDir)).toEqual([]);
  });

  it("returns [] when opencode.json is unparseable JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "opencode.json"), "{ this is not json");
    expect(discoverMcpPaths(tmpDir)).toEqual([]);
  });

  it("skips bare binary names (no /) — PATH-resolved binaries are assumed to exist in the sandbox image", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          a: { command: ["node", "/abs/path/to/dist/bin.js"] },
          b: { command: "python3" },
          c: { command: ["/abs/path/to/another.js", "bash"] },
        },
      }, null, 2),
    );
    const paths = discoverMcpPaths(tmpDir);
    expect(paths).toEqual(expect.arrayContaining(["/abs/path/to/dist/bin.js", "/abs/path/to/another.js"]));
    expect(paths).not.toContain("node");
    expect(paths).not.toContain("python3");
    expect(paths).not.toContain("bash");
  });

  it("de-duplicates paths that appear in multiple servers", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          a: { command: ["/shared/bin.js"] },
          b: { command: ["/shared/bin.js"] },
          c: { command: "/shared/bin.js" },
        },
      }, null, 2),
    );
    const paths = discoverMcpPaths(tmpDir);
    expect(paths).toEqual(["/shared/bin.js"]);
  });
});

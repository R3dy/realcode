import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { classifyIntent, listAvailableProjects, resolveLiveWorkspace } from "../src/engine/conductor.js";

const MISSION_CONTROL_ROOT = process.env.MISSION_CONTROL_ROOT || "/home/royce/mission-control";

describe("Conductor: listAvailableProjects", () => {
  it("returns a non-empty list on the real mission-control root", () => {
    const projects = listAvailableProjects();
    expect(projects.length).toBeGreaterThan(0);
    // The 5 known projects should be present
    expect(projects).toContain("realvol");
    expect(projects).toContain("realhax");
    expect(projects).toContain("realcode");
    expect(projects).toContain("basecamp");
    expect(projects).toContain("realmemory");
  });
});

describe("Conductor: classifyIntent (deterministic matching)", () => {
  let oldApiKey: string | undefined;

  beforeEach(() => {
    oldApiKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (oldApiKey !== undefined) process.env.OPENROUTER_API_KEY = oldApiKey;
    else delete process.env.OPENROUTER_API_KEY;
  });

  it("classifies as change when the idea contains a project name", async () => {
    const result = await classifyIntent("Add a footer to the bottom of the realvol page");
    expect(result.intent).toBe("change");
    expect(result.target_project).toBe("realvol");
    expect(result.flow_type).toBe("agile");
    expect(result.token_usage.total_tokens).toBe(0); // deterministic — no LLM call
  });

  it("classifies as change when [target: <project>] tag is present", async () => {
    const result = await classifyIntent("[target: realmemory] Add a health check endpoint");
    expect(result.intent).toBe("change");
    expect(result.target_project).toBe("realmemory");
    expect(result.flow_type).toBe("agile");
    expect(result.clean_idea).toBe("Add a health check endpoint");
  });

  it("classifies as new when the idea is a new project request", async () => {
    // No project name match, no API key → defaults to "new"
    const result = await classifyIntent("Build a markdown-to-PDF CLI with watch mode");
    expect(result.intent).toBe("new");
    expect(result.target_project).toBeNull();
    expect(result.flow_type).toBe("full");
  });

  it("strips the target tag from clean_idea", async () => {
    const result = await classifyIntent("[target: realvol]   Add a footer to the page   ");
    expect(result.clean_idea).toBe("Add a footer to the page");
  });

  it("handles case-insensitive project name matching", async () => {
    const result = await classifyIntent("Fix the bug in REALVOL");
    expect(result.intent).toBe("change");
    expect(result.target_project).toBe("realvol");
  });

  it("falls back to new (full flow) when [target:] points to unknown project", async () => {
    const result = await classifyIntent("[target: nonexistent] Add a feature");
    // Target tag is stripped but project not found → no deterministic match
    // No API key → defaults to "new"
    expect(result.flow_type).toBe("full");
  });
});

describe("Conductor: resolveLiveWorkspace", () => {
  it("returns the path to the project repo", () => {
    const ws = resolveLiveWorkspace("realvol");
    expect(ws).toBe(path.join(MISSION_CONTROL_ROOT, "PROJECTS", "realvol", "repo"));
  });

  it("the resolved path actually exists for real projects", () => {
    const ws = resolveLiveWorkspace("realcode");
    expect(fs.existsSync(ws)).toBe(true);
  });
});

describe("Conductor: LLM classification fallback", () => {
  it("attempts LLM classification when no deterministic match and API key is set", async () => {
    // Mock fetch to simulate an LLM response
    const originalFetch = global.fetch;
    process.env.OPENROUTER_API_KEY = "test-key";

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          intent: "change",
          target_project: "realvol",
          reasoning: "The request mentions adding a footer to an existing page",
        }) } }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }),
    }) as never;

    try {
      const result = await classifyIntent("Add a footer to the bottom of this page");
      // The LLM said "change" + "realvol" → agile flow
      expect(result.intent).toBe("change");
      expect(result.target_project).toBe("realvol");
      expect(result.flow_type).toBe("agile");
      expect(result.token_usage.total_tokens).toBe(70);
    } finally {
      global.fetch = originalFetch;
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("defaults to new when LLM call fails", async () => {
    const originalFetch = global.fetch;
    process.env.OPENROUTER_API_KEY = "test-key";

    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;

    try {
      const result = await classifyIntent("Add a footer to the bottom of this page");
      expect(result.intent).toBe("new");
      expect(result.flow_type).toBe("full");
      expect(result.reasoning).toContain("LLM classification failed");
    } finally {
      global.fetch = originalFetch;
      delete process.env.OPENROUTER_API_KEY;
    }
  });
});

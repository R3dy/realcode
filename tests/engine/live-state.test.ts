import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  writeLiveState,
  readLiveState,
  appendLiveEvent,
  flushLiveEvents,
  eventFromJsonLine,
  type LiveTraceEvent,
} from "../../src/engine/live-state.js";

let tmpDir: string;
let oldDataDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-livestate-"));
  oldDataDir = process.env.REALCODE_DATA_DIR;
  process.env.REALCODE_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (oldDataDir !== undefined) process.env.REALCODE_DATA_DIR = oldDataDir;
  else delete process.env.REALCODE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function livePath(runId: string): string {
  return path.join(tmpDir, "runs", runId, "live.json");
}

function makeEvent(runId: string, content: string): LiveTraceEvent {
  return {
    kind: "llm-message",
    stage: "frame",
    agent: "frame",
    content,
    timestamp: Date.now(),
    role: "frame",
    tokens: 3,
    cost_usd: 0.001,
  };
}

describe("engine live-state: write/read", () => {
  it("writeLiveState writes live.json at data/runs/{runId}/live.json atomically", () => {
    writeLiveState("run_atomic", { run_id: "run_atomic", stage: "frame", status: "running" });
    const raw = fs.readFileSync(livePath("run_atomic"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.stage).toBe("frame");
    expect(parsed.status).toBe("running");
    expect(parsed.run_id).toBe("run_atomic");
    // No leftover tmp file after the atomic rename.
    expect(fs.readdirSync(path.join(tmpDir, "runs", "run_atomic")).filter((f) => f.includes(".tmp."))).toHaveLength(0);
  });

  it("writeLiveState merges partial shallowly and stamps updated_at", () => {
    writeLiveState("run_merge", { status: "running" });
    const before = readLiveState("run_merge")!;
    writeLiveState("run_merge", { status: "completed" });
    const after = readLiveState("run_merge")!;
    expect(after.status).toBe("completed");
    expect(after.run_id).toBe("run_merge");
    expect(after.updated_at).toBeGreaterThanOrEqual(before.updated_at);
  });

  it("writeLiveState deep-merges container so a partial container_id update keeps name/role", () => {
    writeLiveState("run_c", {
      container: { container_id: null, name: "realcode-r1-frame-0", role: "frame", status: "running", started_at: 1, log_path: "runs/run_c/containers/stage-frame-0.log" },
    });
    writeLiveState("run_c", { container: { container_id: "abc123" } });
    const c = readLiveState("run_c")!.container!;
    expect(c.container_id).toBe("abc123");
    expect(c.name).toBe("realcode-r1-frame-0");
    expect(c.status).toBe("running");
  });

  it("readLiveState returns null when the file is absent or corrupt (never throws)", () => {
    expect(readLiveState("run_missing")).toBeNull();
    writeLiveState("run_corrupt", { status: "running" });
    fs.writeFileSync(livePath("run_corrupt"), "{ not valid json");
    expect(readLiveState("run_corrupt")).toBeNull();
  });

  it("atomic write survives concurrent reads — a reader never sees partial JSON", async () => {
    writeLiveState("run_atomic", { status: "running", stage: "frame" });
    const writes = Array.from({ length: 40 }, (_, i) =>
      Promise.resolve().then(() => {
        writeLiveState("run_atomic", { status: i % 2 ? "running" : "completed", tokens_total: i });
      }),
    );
    const reads = Array.from({ length: 40 }, async () => {
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10)));
      const s = readLiveState("run_atomic");
      if (s === null) return null;
      // If a read succeeds it must be a complete, valid object — never a
      // partial JSON file (the tmp+rename guarantees atomicity).
      expect(s).toHaveProperty("run_id", "run_atomic");
      expect(typeof s.status).toBe("string");
      expect(Array.isArray(s.events)).toBe(true);
      return s.status;
    });
    await Promise.all([...writes, ...reads]);
    const final = readLiveState("run_atomic")!;
    expect(["running", "completed"]).toContain(final.status);
  });
});

describe("engine live-state: appendLiveEvent", () => {
  it("truncates event content to 500 chars", () => {
    appendLiveEvent("run_trunc", makeEvent("run_trunc", "x".repeat(1000)));
    flushLiveEvents("run_trunc");
    const state = readLiveState("run_trunc")!;
    expect(state.events).toHaveLength(1);
    expect(state.events[0].content).toHaveLength(500);
  });

  it("caps the rolling window at 200 events (drops oldest from the front)", () => {
    const runId = "run_cap";
    for (let i = 0; i < 201; i++) {
      appendLiveEvent(runId, makeEvent(runId, `event-${i}`));
      flushLiveEvents(runId);
    }
    const state = readLiveState(runId)!;
    expect(state.events).toHaveLength(200);
    // Oldest (event-0) dropped from the front; last (event-200) retained.
    expect(state.events[0].content).toBe("event-1");
    expect(state.events[state.events.length - 1].content).toBe("event-200");
  });

  it("accumulates tokens_total and cost_usd across events", () => {
    const runId = "run_tokens";
    for (let i = 0; i < 4; i++) {
      appendLiveEvent(runId, { ...makeEvent(runId, `e${i}`), tokens: 10, cost_usd: 0.01 });
    }
    flushLiveEvents(runId);
    const state = readLiveState(runId)!;
    expect(state.tokens_total).toBe(40);
    expect(state.cost_usd).toBeCloseTo(0.04, 6);
  });

  it("coalesces bursts at 250ms into a single trailing file rewrite", async () => {
    const runId = "run_coalesce";
    vi.useFakeTimers();
    try {
      appendLiveEvent(runId, makeEvent(runId, "a"));
      appendLiveEvent(runId, makeEvent(runId, "b"));
      appendLiveEvent(runId, makeEvent(runId, "c"));
      appendLiveEvent(runId, makeEvent(runId, "d"));
      appendLiveEvent(runId, makeEvent(runId, "e"));
      // Coalescing: no per-append file write happened yet — all five events
      // are buffered until the 250ms trailing flush fires.
      expect(fs.existsSync(livePath(runId))).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
      // A single trailing flush wrote all five events.
      const state = readLiveState(runId)!;
      expect(state.events.map((e) => e.content)).toEqual(["a", "b", "c", "d", "e"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushLiveEvents writes buffered events immediately (trailing flush never drops the last event)", () => {
    const runId = "run_flush";
    appendLiveEvent(runId, makeEvent(runId, "last-event"));
    flushLiveEvents(runId);
    const state = readLiveState(runId)!;
    expect(state.events.map((e) => e.content)).toEqual(["last-event"]);
  });
});

describe("engine live-state: eventFromJsonLine", () => {
  it("converts a raw opencode event part into a LiveTraceEvent", () => {
    const ev = eventFromJsonLine(
      {
        part: {
          type: "text",
          text: "hello",
          tokens: { input: 5, output: 3, total: 8 },
          cost: 0.002,
        },
      },
      "discover",
    );
    expect(ev).not.toBeNull();
    expect(ev!.kind).toBe("llm-message");
    expect(ev!.stage).toBe("discover");
    expect(ev!.role).toBe("discover");
    expect(ev!.content).toBe("hello");
    expect(ev!.tokens).toBe(8);
    expect(ev!.cost_usd).toBe(0.002);
    expect(typeof ev!.timestamp).toBe("number");
  });

  it("maps tool_use parts to tool-call kind and carries the tool", () => {
    const ev = eventFromJsonLine({ part: { type: "tool_use", tool: "bash", text: "ls" } }, "plan");
    expect(ev!.kind).toBe("tool-call");
    expect(ev!.tool).toBe("bash");
  });

  it("maps error parts to error kind", () => {
    const ev = eventFromJsonLine({ part: { type: "error", text: "boom" } }, "ship");
    expect(ev!.kind).toBe("error");
    // A tool-less error with no raw `tool` field must not fabricate one.
    expect(ev!.tool).toBeUndefined();
  });

  it("returns null for events with no part", () => {
    expect(eventFromJsonLine({ foo: "bar" }, "frame")).toBeNull();
    expect(eventFromJsonLine(null, "frame")).toBeNull();
    expect(eventFromJsonLine(undefined, "frame")).toBeNull();
  });

  it("pre-truncates long text to 500 chars", () => {
    const ev = eventFromJsonLine({ part: { type: "text", text: "z".repeat(1000) } }, "spec");
    expect(ev!.content).toHaveLength(500);
  });
});
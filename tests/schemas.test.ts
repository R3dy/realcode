import { describe, it, expect } from "vitest";
import { FrameOutput } from "../src/schemas/frame.js";
import { DiscoverOutput } from "../src/schemas/discover.js";
import { PlanOutput } from "../src/schemas/plan.js";
import { SpecOutput } from "../src/schemas/spec.js";
import { BuildOutput } from "../src/schemas/build.js";
import { ShipOutput } from "../src/schemas/ship.js";

const baseFields = {
  schema_version: 1 as const,
  run_id: "run_test01",
  trace_id: "trace_test01",
  gate_verdict: "pass" as const,
  gate_notes: "looks good",
  token_usage: {
    prompt_tokens: 1000,
    completion_tokens: 500,
    total_tokens: 1500,
    estimated_cost_usd: 0.05,
  },
};

describe("FrameOutput schema", () => {
  it("validates a well-formed output", () => {
    const valid = FrameOutput.safeParse({
      ...baseFields,
      stage: "frame",
      status: "framed",
      artifact: {
        project_md: "# My Project\n...",
        project_type: "cli",
        has_ui: false,
        is_sellable: false,
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { artifact, ...rest } = {
      ...baseFields,
      stage: "frame",
      status: "framed",
      artifact: {
        project_md: "# My Project",
        project_type: "cli" as const,
        has_ui: false,
        is_sellable: false,
      },
    };
    const missing = { ...rest, artifact: { ...artifact, project_md: undefined } };
    expect(FrameOutput.safeParse(missing).success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const invalid = {
      ...baseFields,
      stage: "frame",
      status: "shipped",
      artifact: {
        project_md: "# My Project",
        project_type: "cli",
        has_ui: false,
        is_sellable: false,
      },
    };
    expect(FrameOutput.safeParse(invalid).success).toBe(false);
  });
});

describe("DiscoverOutput schema", () => {
  it("validates a well-formed output", () => {
    const valid = DiscoverOutput.safeParse({
      ...baseFields,
      stage: "discover",
      status: "discovered",
      artifact: {
        discovery_md: "# Discovery\n...",
        lite_mode: true,
        failure_modes: [{ mode: "runaway loops", mitigation: "3 retries max" }],
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects empty failure_modes", () => {
    const invalid = DiscoverOutput.safeParse({
      ...baseFields,
      stage: "discover",
      status: "discovered",
      artifact: {
        discovery_md: "# Discovery",
        lite_mode: true,
        failure_modes: [],
      },
    });
    expect(invalid.success).toBe(false);
  });
});

describe("PlanOutput schema", () => {
  it("validates a well-formed output", () => {
    const valid = PlanOutput.safeParse({
      ...baseFields,
      stage: "plan",
      status: "planned",
      artifact: {
        prd_md: "# PRD\n...",
        adrs: [{ id: "ADR-001", title: "Stage graph", status: "Accepted" }],
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects with zero ADRs", () => {
    const invalid = PlanOutput.safeParse({
      ...baseFields,
      stage: "plan",
      status: "planned",
      artifact: {
        prd_md: "# PRD",
        adrs: [],
      },
    });
    expect(invalid.success).toBe(false);
  });
});

describe("SpecOutput schema", () => {
  it("validates a well-formed output", () => {
    const valid = SpecOutput.safeParse({
      ...baseFields,
      stage: "spec",
      status: "specified",
      artifact: {
        epics_md: "# Epics",
        backlog_md: "# Backlog",
        dependency_graph: "M0 -> M1 -> M2",
        story_count: 10,
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects story_count of 0", () => {
    const invalid = SpecOutput.safeParse({
      ...baseFields,
      stage: "spec",
      status: "specified",
      artifact: {
        epics_md: "# Epics",
        backlog_md: "# Backlog",
        dependency_graph: "M0 -> M1",
        story_count: 0,
      },
    });
    expect(invalid.success).toBe(false);
  });
});

describe("BuildOutput schema", () => {
  it("validates a well-formed output", () => {
    const valid = BuildOutput.safeParse({
      ...baseFields,
      stage: "build",
      status: "built",
      artifact: {
        repo_path: "/repos/my-project",
        test_results: { passed: 10, failed: 0, skipped: 1, coverage_pct: 85 },
        prs_merged: [{ number: 1, title: "feat: init", url: "https://github.com/x/y/pull/1" }],
        escalations: [],
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects negative test counts", () => {
    const invalid = BuildOutput.safeParse({
      ...baseFields,
      stage: "build",
      status: "built",
      artifact: {
        repo_path: "/repos/my-project",
        test_results: { passed: -1, failed: 0, skipped: 0, coverage_pct: 50 },
      },
    });
    expect(invalid.success).toBe(false);
  });
});

describe("ShipOutput schema", () => {
  it("validates with live_url", () => {
    const valid = ShipOutput.safeParse({
      ...baseFields,
      stage: "ship",
      status: "shipped",
      artifact: {
        live_url: "https://my-app.vercel.app",
        launch_checklist_md: "# Launch Checklist",
        metrics_dashboard_md: "# Metrics",
      },
    });
    expect(valid.success).toBe(true);
  });

  it("validates with repo_url only", () => {
    const valid = ShipOutput.safeParse({
      ...baseFields,
      stage: "ship",
      status: "shipped",
      artifact: {
        repo_url: "https://github.com/x/y",
        launch_checklist_md: "# Launch Checklist",
        metrics_dashboard_md: "# Metrics",
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects with neither live_url nor repo_url", () => {
    const invalid = ShipOutput.safeParse({
      ...baseFields,
      stage: "ship",
      status: "shipped",
      artifact: {
        launch_checklist_md: "# Launch Checklist",
        metrics_dashboard_md: "# Metrics",
      },
    });
    expect(invalid.success).toBe(false);
  });
});

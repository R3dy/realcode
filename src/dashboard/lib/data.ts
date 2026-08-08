export type StageName = "frame" | "discover" | "plan" | "spec" | "build" | "ship";
export type StageStatus = "pass" | "running" | "fail" | "pause" | "pending";
export type RunStatus =
  | "running"
  | "paused_step"
  | "escalated"
  | "paused_cost_cap"
  | "shipped"
  | "failed";

export interface Stage {
  name: StageName;
  status: StageStatus;
  tokens: number;
  costUsd: number;
  latencyMs: number;
  turns?: Turn[];
}

export interface ToolCall {
  name: string;
  args: string;
  tokens: number;
  latencyMs: number;
}

export interface Turn {
  agent: string;
  model: string;
  tokens: number;
  costUsd: number;
  latencyMs: number;
  tools: ToolCall[];
  note: string;
}

export interface Run {
  id: string;
  idea: string;
  status: RunStatus;
  current: StageName;
  stages: Stage[];
  costUsd: number;
  capUsd: number;
  latencyMs: number;
  createdAt: string;
  escalationReason?: string;
}

export const STAGE_ORDER: StageName[] = ["frame", "discover", "plan", "spec", "build", "ship"];

const m = (ms: number) => ms;
const k = (n: number) => n;

function stage(
  name: StageName,
  status: StageStatus,
  tokens: number,
  costUsd: number,
  latencyMs: number,
  turns?: Turn[],
): Stage {
  return { name, status, tokens, costUsd, latencyMs, turns };
}

function turn(
  agent: string,
  model: string,
  tokens: number,
  costUsd: number,
  latencyMs: number,
  note: string,
  tools: ToolCall[],
): Turn {
  return { agent, model, tokens, costUsd, latencyMs, note, tools };
}

const tc = (name: string, args: string, tokens: number, latencyMs: number): ToolCall => ({
  name, args, tokens, latencyMs,
});

const mkTrace = (
  upTo: StageName,
  statuses: Partial<Record<StageName, StageStatus>>,
): Stage[] => {
  const idx = STAGE_ORDER.indexOf(upTo);
  return STAGE_ORDER.map((s, i) => {
    const status = statuses[s] ?? (i < idx ? "pass" : i === idx ? statuses[s] ?? "pending" : "pending");
    if (i > idx || status === "pending") return stage(s, "pending", 0, 0, 0);
    return stage(s, status, k(30 + i * 12), +(0.08 + i * 0.22).toFixed(2), m(40000 + i * 60000));
  });
};

export const runs: Run[] = [
  {
    id: "run_2k9f3a",
    idea: "Build a markdown-to-PDF CLI with watch mode",
    status: "shipped",
    current: "ship",
    costUsd: 1.84,
    capUsd: 8.0,
    latencyMs: 18 * 60000 + 4000,
    createdAt: "2026-08-06T09:14:00Z",
    stages: mkTrace("ship", { ship: "pass" }),
  },
  {
    id: "run_8h2c1x",
    idea: "SaaS landing page + email waitlist",
    status: "running",
    current: "build",
    costUsd: 1.2,
    capUsd: 8.0,
    latencyMs: 7 * 60000 + 12000,
    createdAt: "2026-08-06T10:02:00Z",
    stages: mkTrace("build", { build: "running" }),
  },
  {
    id: "run_4d7v9q",
    idea: "Slack bot that summarizes a channel daily",
    status: "paused_cost_cap",
    current: "build",
    costUsd: 8.0,
    capUsd: 8.0,
    latencyMs: 42 * 60000,
    createdAt: "2026-08-05T16:31:00Z",
    escalationReason: "Cost cap hit ($8.00) during build story 7 of 11. Resume requires lowering the cap or approving more spend.",
    stages: mkTrace("build", { build: "fail" }),
  },
  {
    id: "run_1m6b3w",
    idea: "REST API for a habit tracker",
    status: "escalated",
    current: "build",
    costUsd: 3.47,
    capUsd: 8.0,
    latencyMs: 29 * 60000,
    createdAt: "2026-08-06T08:48:00Z",
    escalationReason: "Story 3.2 (auth middleware) failed validation 3x: tests expect 401 on expired token, worker returned 200. Escalated per retry ceiling.",
    stages: mkTrace("build", { build: "fail" }),
  },
  {
    id: "run_9z5k2e",
    idea: "Personal portfolio static site",
    status: "paused_step",
    current: "plan",
    costUsd: 0.31,
    capUsd: 8.0,
    latencyMs: 4 * 60000,
    createdAt: "2026-08-06T11:20:00Z",
    stages: mkTrace("plan", { plan: "pause" }),
  },
  {
    id: "run_7p3a8r",
    idea: "CLI to convert CSV to JSON",
    status: "shipped",
    current: "ship",
    costUsd: 0.42,
    capUsd: 8.0,
    latencyMs: 6 * 60000 + 12000,
    createdAt: "2026-08-06T07:55:00Z",
    stages: mkTrace("ship", { ship: "pass" }),
  },
  {
    id: "run_5t1f4n",
    idea: "Image gallery SaaS with auth",
    status: "running",
    current: "discover",
    costUsd: 0.18,
    capUsd: 8.0,
    latencyMs: 90 * 1000,
    createdAt: "2026-08-06T11:38:00Z",
    stages: mkTrace("discover", { discover: "running" }),
  },
  {
    id: "run_6q2b7y",
    idea: "Library: typed env var parser",
    status: "shipped",
    current: "ship",
    costUsd: 0.31,
    capUsd: 8.0,
    latencyMs: 4 * 60000 + 51000,
    createdAt: "2026-08-06T06:40:00Z",
    stages: mkTrace("ship", { ship: "pass" }),
  },
];

export function getRun(id: string): Run | undefined {
  const r = runs.find((x) => x.id === id);
  if (!r) return undefined;
  return enrichTrace(r);
}

function enrichTrace(r: Run): Run {
  const stages = r.stages.map((s) => {
    if (s.status === "pending") return s;
    return { ...s, turns: turnsFor(r, s) };
  });
  return { ...r, stages };
}

function turnsFor(run: Run, s: Stage): Turn[] {
  const base: Record<StageName, { agent: string; model: string; note: string }> = {
    frame: { agent: "anymake-product-owner-proxy", model: "claude-opus-5 (tier 1)", note: "Framed scope: CLI tool, MVP scope locked, success = ships in <25m." },
    discover: { agent: "anymake-discover", model: "claude-sonnet-5 (tier 2)", note: "Prior-art pass (pandoc, md-to-pdf); risk: no runaway." },
    plan: { agent: "anymake-plan", model: "claude-opus-5 (tier 1)", note: "PRD + ADR-001 (arch: Node, commander.js, Playwright for watch)." },
    spec: { agent: "anymake-spec", model: "claude-sonnet-5 (tier 2)", note: "Backlog: 9 stories, dependency graph acyclic." },
    build: { agent: "anymake-worker", model: "claude-haiku-4.5 (tier 3)", note: "Executing story 4.2: PDF render via headless Chromium." },
    ship: { agent: "anymake-deploy", model: "claude-sonnet-5 (tier 2)", note: "Published to npm + smoke-tested the binary." },
  };
  const b = base[s.name];
  const isFail = s.status === "fail";
  const isRun = s.status === "running";
  const turns: Turn[] = [];
  const n = isFail ? 3 : isRun ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const tokens = k(1200 + i * 800 + (s.name === "build" ? 6000 : 0));
    const cost = +(tokens / 1000 * 0.012).toFixed(3);
    const tools = toolsFor(s.name, i, isFail && i === n - 1);
    turns.push(
      turn(b.agent + (n > 1 ? ` #${i + 1}` : ""), b.model, tokens, cost,
        m(8000 + i * 4000 + (s.name === "build" ? 20000 : 0)),
        isFail && i === n - 1 ? "Validation FAIL: " + (run.escalationReason?.slice(0, 80) ?? "tests red") + "..." : b.note,
        tools,
      ),
    );
  }
  return turns;
}

function toolsFor(stage: StageName, i: number, fail: boolean): ToolCall[] {
  const file = (p: string) => tc("Read", p, 320 + i * 40, 90 + i * 10);
  const write = (p: string) => tc("Write", p, 900 + i * 200, 1400 + i * 120);
  switch (stage) {
    case "frame": return [file("TEMPLATES/project.md"), write("PROJECT.md"), tc("Skill", "anymake", 200, 60)];
    case "discover": return [tc("WebFetch", "pandoc.org/MANUAL.html", 800, 1200), write("docs/01-discovery.md")];
    case "plan": return [file("docs/01-discovery.md"), write("docs/02-planning/prd.md"), write("docs/02-planning/architecture/ADR-001.md")];
    case "spec": return [file("docs/02-planning/prd.md"), write("docs/03-solutioning/backlog.md")];
    case "build":
      return fail
        ? [file("src/auth/middleware.ts"), write("src/auth/middleware.ts"), tc("Bash", "npm test -- auth", 1500, 9000), tc("Bash", "gh pr comment", 200, 800)]
        : [file("src/render/pdf.ts"), write("src/render/pdf.ts"), tc("Bash", "npm test", 1800, 11000), tc("Bash", "git commit -m", 120, 300)];
    case "ship": return [tc("Bash", "npm publish", 400, 8000), tc("Bash", "realcode smoke", 300, 4000)];
    default: return [];
  }
}

export const stats = {
  activeRuns: runs.filter((r) => r.status === "running").length,
  todaySpend: runs.reduce((a, r) => a + r.costUsd, 0),
  shippedToday: runs.filter((r) => r.status === "shipped").length,
  avgCostPerRun: +(runs.reduce((a, r) => a + r.costUsd, 0) / runs.length).toFixed(2),
  escalations: runs.filter((r) => r.status === "escalated" || r.status === "paused_cost_cap").length,
};

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`;
}

export function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function fmtLatency(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

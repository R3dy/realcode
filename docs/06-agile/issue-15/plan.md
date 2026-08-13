# Development Plan — Issue #15: Dashboard: parse container logs into collapsible structured rows

**Author:** Anymake Solution Architect
**Project:** realcode — `project_type: agentic-harness`
**Issue:** https://github.com/R3dy/realcode/issues/15 — `type:feature`
**Code state analyzed:** f9948dd (main)
**Status:** In Review (round 2)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-15/plan.md`

---

## 1. Problem Statement

Container log files at `data/runs/[runId]/containers/*.log` are JSONL — each line a JSON object emitted by the OpenCode SDK with a `type` field (`step_start`, `step_finish`, `tool_use`, `text`). The dashboard's `ContainerLogViewer.tsx` fetches this raw text via `GET /api/runs/[id]/containers/[cid]/logs` and renders it unmodified in a `<pre>` block (`ContainerLogViewer.tsx:123`). A typical file is ~70KB of dense JSONL — completely unreadable for an operator trying to follow what an agent did during a run. The issue asks for a client-side parser plus a collapsible-row UI modeled on `LiveTraceStream.tsx`'s `TraceRow`, so each log entry renders as a structured, expandable row (type badge, tool name, token/cost summary, timestamp in the header; tool input/output and LLM text in the expandable body). No backend change. See [issue #15](https://github.com/R3dy/realcode/issues/15) — the issue is the requirement; this plan is the solution.

---

## 2. Root Cause / Motivation

**Motivation (feature).** The `agentic-harness` project type's success model is *operator visibility into pipeline runs* (per `PROJECT_TYPES/agentic-harness/manifest.md`). Container logs are the most detailed record of what an agent actually did during a step — which tools it called, with what inputs and outputs, how many tokens it burned, what it reasoned about. Today that record is a wall of JSONL. This feature directly serves the success axis: making container logs readable is core observability, not a cosmetic nicety. The live trace (`LiveTraceStream.tsx`) already does this for in-flight runs; container logs are the persisted after-the-fact equivalent and deserve the same treatment.

**Why now:** the build-loop now runs and the dashboard is the only window an operator has into a completed run. Without this, post-mortem of a failed/degraded run requires `cat`-ing a 70KB JSONL file by hand.

---

## 3. Current-State Review

| Touched | Details |
|---------|---------|
| Modules | Dashboard observability surface (`src/dashboard/components/ContainerLogViewer.tsx`); new parser module (`src/dashboard/lib/parseContainerLogs.ts`). Visual reference: `src/dashboard/components/LiveTraceStream.tsx` (read-only). Design system: `src/dashboard/components/ui.tsx`. |
| Data model | none — no schema, no API change. Parses existing `text` string client-side. |
| Flows | `GET /api/runs/[id]/containers/[cid]/logs` → `{container_id, log_path, text}` → (currently) `<pre>{text}</pre>` → (after) `parseContainerLogs(text)` → `ParsedLogEntry[]` → collapsible rows. Existing tail/full toggle + polling preserved. |
| Integrations | none — OpenCode SDK JSONL format is the only external contract, parsed read-only. |

**Intent-layer freshness:** `docs/SYSTEM_MAP.md` last mapped 2026-08-11 (commit predates f9948dd). Slightly stale overall, but the dashboard architecture section is accurate for this change's narrow scope (single component render path + one new pure-function module). No Cartographer refresh required for an Additive change of this size; the Cartographer will re-map on the next agile cycle.

---

## 4. Solution Design

**Approach:** pure client-side. No API, no engine, no build-loop changes. Two files: one new parser module, one rewritten render in the existing viewer.

### 4.1 New module — `src/dashboard/lib/parseContainerLogs.ts`

A pure function, no React, no side effects:

```ts
export type LogKind = "step_start" | "step_finish" | "tool_use" | "text" | "raw";

export interface ParsedLogEntry {
  index: number;          // original line index (pre-dedup), for stable keys
  kind: LogKind;
  timestamp: number;      // ms epoch, from top-level `timestamp`
  sessionID?: string;
  tool?: string;          // for tool_use: "read"|"bash"|"edit"|...
  callID?: string;        // for tool_use
  messageID?: string;     // for step_start/step_finish/text
  reason?: string;        // for step_finish: "tool-calls"|"stop"
  tokens?: { total: number; input: number; output: number; reasoning: number; cache?: { write: number; read: number } };
  cost?: number;          // for step_finish
  input?: unknown;        // for tool_use: part.state.input (object)
  output?: string;        // for tool_use: part.state.output (string, may be truncated by SDK to 2000 chars)
  status?: string;        // for tool_use: "completed"|"error"
  content: string;        // primary display text — part.text for `text`, reason for step_finish, "" otherwise; raw line for `raw`
  raw: string;            // the original line, always preserved (for "show raw" / debugging)
}

export function parseContainerLogs(text: string): ParsedLogEntry[];
```

**Parsing algorithm:**
1. Split `text` on `\n`. Drop trailing empty line.
2. For each line, `JSON.parse` in try/catch.
   - On failure → entry `{ kind: "raw", content: line, raw: line, index }`.
   - On success → read top-level `type`, `timestamp`, `sessionID`, and `part` (the SDK wraps the typed payload in `part`). **Dispatch on the TOP-LEVEL `type` field** — it is the reliable discriminator: its values (`step_start`, `step_finish`, `tool_use`, `text`) match `LogKind` exactly (underscores). Do NOT dispatch on `part.type` (whose values are hyphenated SDK-internal tags — `step-start`, `step-finish`, `tool`, `text` — that do not line up with `LogKind` and would route nearly every entry to `raw`). Use `type` to set `kind`; then read the payload fields from `part` (`part.tool`, `part.callID`, `part.state.input`, `part.state.output`, `part.tokens`, `part.cost`, `part.reason`, `part.text`). Unknown top-level `type` → `kind: "raw"` with `content` = the line, so forward-compatibility degrades gracefully.
3. **Deduplication:** the OpenCode SDK emits each event twice — and the duplicates are not always consecutive. Real log files show TWO patterns: (a) consecutive identical lines (`[step_start, step_start]`), and (b) **interleaved** duplicates (`[tool_use_A, step_finish_A, tool_use_A, step_finish_A]` where entry 1≡3 and 2≡4). Consecutive-only dedup misses pattern (b). Therefore use a **seen-set dedup**: maintain a `Set<string>` of seen keys, where the key is the tuple string `(kind, timestamp, callID | messageID | "")`. For each parsed entry, compute its key; if the key is already in the set, drop the entry; otherwise add the key to the set and keep the entry. This collapses both consecutive and interleaved duplicates. (A `callID` is unique per tool invocation and a `messageID` per step, so the tuple is a safe identity key — two genuinely-separate events never share it.) Re-index the survivors so `index` is contiguous post-dedup (callers use it as a React key into the filtered array).
4. Return the array. Empty input → `[]`.

The parser is fully deterministic and side-effect-free, so it is trivially unit-testable.

### 4.2 Rewrite — `src/dashboard/components/ContainerLogViewer.tsx`

Keep everything above the render: the fetch, the `text` state, the tail/full toggle, the polling interval. Replace only the `<pre>{text}</pre>` block (line 123) with:

```
const entries = useMemo(() => parseContainerLogs(text), [text]);
const [filter, setFilter] = useState<LogKind | "all">("all");
const [expanded, setExpanded] = useState<Set<number>>(new Set());
const filtered = filter === "all" ? entries : entries.filter(e => e.kind === filter);
```

**Layout (top to bottom):**
1. **Toolbar row** — existing tail/full toggle (unchanged) + new controls:
   - Type filter `<select>` (all / step_start / step_finish / tool_use / text / raw). Styled to match `LiveTraceStream`'s `FilterSelect`: `bg-ink-900 border border-ink-700 text-ink-100 text-xs rounded px-2 py-1`.
   - "Expand all" / "Collapse all" button pair (text buttons, `text-xs text-ink-300 hover:text-ink-100`). Expand-all sets `expanded` to a `Set` of all filtered indices; collapse-all clears it.
2. **Row list** — `filtered.map((entry, i) => <CollapsibleLogRow ... />)`. Empty state when `filtered.length === 0`: a muted `text-ink-500 text-xs` "No log entries" line (and a hint if the raw text was non-empty but everything was filtered out).

**`CollapsibleLogRow` (inline component in the same file):**
- **Header (always visible):** a single clickable row, `cursor-pointer`, `flex items-center gap-2 px-3 py-1.5 border-b border-ink-900 hover:bg-ink-900/50 font-mono text-[11px]`. Contents left→right:
  - Chevron: `<ChevronRight />` when collapsed, `<ChevronDown />` when expanded (lucide-react, `size-3 text-ink-500`).
  - Type `Badge` with tone by kind: `tool_use`→brand, `step_start`→neutral, `step_finish`→pass, `text`→neutral, `raw`→fail. Badge text = kind.
  - Tool name (tool_use only): `<Wrench className="size-3 text-ink-400" />` + `entry.tool` in `text-ink-100`. Omit for non-tool kinds.
  - Token/cost summary (step_finish only): `<Cpu className="size-3 text-ink-400" />` + `tokens.total` + `<Coins className="size-3 text-ink-400" />` + `$${cost.toFixed(4)}`. Omit otherwise.
  - Status pip (tool_use with status:"error"): a `StatusDot` in fail tone, or `<Badge tone="fail">error</Badge>`.
  - Timestamp (right-aligned, `ml-auto text-ink-500 text-[10px]`): `new Date(timestamp).toLocaleTimeString()` with ms.
- **Body (expanded only):** `px-3 py-2 bg-ink-950 border-b border-ink-900`. Content by kind:
  - `tool_use`: a two-row block — **Input** (`text-[10px] text-ink-500 uppercase tracking-wide` label) then a `<pre className="font-mono text-[11px] text-ink-200 whitespace-pre-wrap break-all">` of `JSON.stringify(input, null, 2)`; **Output** label then a scrollable container `<pre className="... max-h-64 overflow-auto">` of `output`. Scrollable max-height (256px) handles the truncated-but-still-long SDK output without nested expand state (per design decision #6).
  - `text`: `<pre className="font-mono text-[11px] text-ink-200 whitespace-pre-wrap break-all max-h-96 overflow-auto">` of `content` (the `part.text`, which may contain `<artifact>...</artifact>` JSON). Same scrollable-container pattern.
  - `step_finish`: a small key/value grid — reason, tokens breakdown (total/input/output/reasoning/cache.read/cache.write), cost. `font-mono text-[11px]`.
  - `step_start`: minimal — messageID + sessionID in `text-ink-400 text-[11px]`.
  - `raw`: `<pre className="font-mono text-[11px] text-amber-400/80 whitespace-pre-wrap break-all">` of the raw line (amber to signal "unrecognized").

Click handler on the header: `setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })`.

### 4.3 What does NOT change
- `GET /api/runs/[id]/containers/[cid]/logs` — response shape `{container_id, log_path, text}` unchanged.
- `LiveTraceStream.tsx` — visual reference only, not modified.
- Polling / tail / full-toggle behavior — preserved verbatim.
- Engine, build-loop, API routes — untouched.

---

## 5. Alternatives Considered

| Option | Why not chosen |
|--------|----------------|
| **Server-side parsing** — add a `GET /api/runs/[id]/containers/[cid]/logs?format=parsed` that returns `ParsedLogEntry[]` from the server. | Touches the API surface (out of scope per the issue: "No backend change"). Adds a server code path to maintain for a transformation that is trivially client-side. The raw text is already on the wire; parsing it again server-side doubles the surface area for zero benefit. |
| **Reuse `LiveTraceStream`'s `TraceRow` directly** by feeding parsed container logs into the live-trace component. | `TraceRow` has no expand/collapse — it always renders its body inline, which is right for a live tail (you want to see everything streaming) but wrong for a 70KB persisted log (you want scan-then-drill-in). The issue explicitly asks for collapsible rows. Reusing `TraceRow` would require modifying it, which in turn risks the live trace's behavior — expanding blast radius into a working feature for no gain. A separate `CollapsibleLogRow` that *visually echoes* `TraceRow` (same Badge tones, same font sizing, same color tokens) gets the consistency without the coupling. |
| **Virtualized list** (e.g. `react-window`) for the row list. | Premature. A 70KB JSONL file is on the order of a few hundred to low-thousands of lines post-dedup; React handles that fine without virtualization. Adds a dependency and complexity for a case that doesn't yet hurt. Logged in PARKING_LOT.md if container logs grow to 10k+ lines. |

---

## 6. Intent Constraints

Classification against the intent layer (`docs/DECISIONS.md`, `docs/INVARIANTS.md`) per the Intent Conflict Policy (`AGENTS/arbiter.md`):

**Classification:** Additive

- `docs/DECISIONS.md` — does not yet exist. The project's ADRs live in `docs/02-planning/architecture/`. No ADR touches the dashboard log-viewer render path; the closest observability-relevant decisions concern the live trace (which this plan does not modify). **No ADR touched.**
- `docs/INVARIANTS.md` — does not yet exist. The implicit invariant in play is "the dashboard is a read-only view over run artifacts; it never mutates engine state." This plan preserves it: parsing is pure, rendering is pure, no API call is added or changed. **No invariant violated.**
- `docs/SYSTEM_MAP.md` — the dashboard architecture section is accurate for this scope. A new module (`parseContainerLogs.ts`) is added under `src/dashboard/lib/`, consistent with the existing `src/dashboard/lib/` convention. The Cartographer will pick it up on the next mapping cycle; no manual refresh needed for an Additive change.

**Conflict gate:** N/A — Additive, no intent contradiction.

---

## 7. Design Consistency

New UI must look like it was designed with the product from day one. Reference `docs/02-planning/ux-design.md` (Design DNA + component inventory):

| Question | Answer |
|----------|--------|
| Existing components reused | `Badge` (with `tone`), `StatusDot`, `cn` — all from `src/dashboard/components/ui.tsx`. `ChevronRight`/`ChevronDown`/`Wrench`/`Cpu`/`Coins` from `lucide-react` (already a project dependency, used by `LiveTraceStream`). |
| New components introduced | `CollapsibleLogRow` (inline in `ContainerLogViewer.tsx`) — no existing component has expand/collapse semantics, so none fits. Not extracted to `ui.tsx` because it is single-use; if a second collapsible-row consumer appears later, extraction becomes a follow-up. |
| Design DNA mapping | Colors: `ink-950`/`ink-900`/`ink-700`/`ink-500`/`ink-400`/`ink-200`/`ink-100` tokens (the existing dark-theme palette, identical to `LiveTraceStream`). Type: `font-mono`, `text-[11px]` for rows, `text-[10px]` for timestamps/labels, `text-xs` for toolbar controls — matches `TraceRow` sizing exactly. Spacing: `px-3 py-1.5` header, `px-3 py-2` body, `gap-2` — matches existing dashboard rows. State: hover `bg-ink-900/50` on header rows (same as live-trace row hover). Badge tones by kind mirror `LiveTraceStream`'s tone mapping. |
| New visual patterns | none. The collapsible-row pattern is new to this component but is the standard "scan + drill-in" list pattern; it reuses only existing tokens and components. No `ux-design.md` update required. |

Rule satisfied: no new visual pattern ships without a `ux-design.md` update — and no new pattern is shipping.

---

## 8. Blast Radius & Regression Risk

| At risk | Why it's in the blast radius | Protection |
|---------|------------------------------|------------|
| Container log viewing (the feature itself) | `ContainerLogViewer.tsx` render is rewritten end-to-end. | §10 Experience Script drives the viewer on a real run; parser unit tests cover valid/malformed/dedup; if parsing throws on any line, the `raw` fallback + the component's existing error boundary keep the UI standing. |
| `LiveTraceStream.tsx` | Shared visual vocabulary (Badge tones, icons) — a careless edit could drift the two apart. | `LiveTraceStream.tsx` is NOT modified (scope boundary). No shared code is extracted, so no coupling risk. |
| API contract expectation | A future caller might assume `text` is rendered verbatim. | The raw text is still fetched and still available; `ParsedLogEntry.raw` preserves every original line. The `raw` kind + "show raw" content means no information is lost. |
| Polling / tail behavior | The rewrite touches the render block, which sits inside the polling component. | The `useMemo` over `text` re-parses on each poll; expanded-state `Set` is keyed by post-dedup index, which is stable across re-parses of the same text (dedup is deterministic). Tail mode appends — new entries get new indices, existing expanded rows stay expanded. |

**Migrations:** none — no schema, no API, no build-loop change.

---

## 9. Story Breakdown

One story. The parser and its UI consumer are tightly coupled (the UI exists to render the parser's output) and small enough to land in a single PR; splitting would create a dead-checked-in parser module with no consumer for the duration of story 2. Per the issue's scope and the "do not over-split" guidance, one story is correct.

### Story A15.1 — Collapsible structured container log viewer

**As a** realcode operator **I want** the container log viewer to parse JSONL into collapsible structured rows (type badge, tool name, token/cost summary, timestamp in the header; tool input/output and LLM text in the expandable body) **so that** I can scan a run's container log at a glance and drill into individual tool calls / LLM outputs without reading 70KB of raw JSONL.

**Acceptance criteria:**
- [ ] `src/dashboard/lib/parseContainerLogs.ts` exports `parseContainerLogs(text: string): ParsedLogEntry[]` as a pure function (no React, no side effects, no network).
- [ ] Parser correctly handles each SDK kind: `step_start`, `step_finish` (with `tokens` + `cost`), `tool_use` (with `tool`, `callID`, `input`, `output`, `status`), `text` (with `content` = `part.text`).
- [ ] Parser is robust to malformed/non-JSON lines: they become entries with `kind: "raw"` and `content` = the raw line; parsing never throws.
- [ ] Parser deduplicates consecutive identical entries by `(kind, timestamp, callID | messageID | "")`, collapsing the OpenCode SDK's double-emit.
- [ ] `ContainerLogViewer.tsx` renders parsed entries as collapsible rows (header always visible, body hidden until clicked). Default collapsed.
- [ ] Header shows: chevron, type `Badge` (tone by kind), tool name + `Wrench` icon (tool_use only), token/cost summary + `Cpu`/`Coins` icons (step_finish only), error `Badge` (tool_use with status:"error"), right-aligned timestamp.
- [ ] Body shows kind-appropriate content: tool input/output (scrollable `max-h-64`), LLM text (scrollable `max-h-96`), step_finish token/cost grid, step_start IDs, raw line (amber).
- [ ] "Expand all" / "Collapse all" controls in the toolbar expand/collapse every filtered row.
- [ ] Type filter dropdown (all/step_start/step_finish/tool_use/text/raw) filters the row list.
- [ ] Existing tail/full toggle and polling behavior are preserved unchanged.
- [ ] All new UI uses existing `Badge`/`StatusDot`/`cn` from `ui.tsx` and lucide-react icons, matching `LiveTraceStream`'s Design DNA (ink tokens, font-mono, text-[11px] rows) per §7.
- [ ] No backend, API, engine, or build-loop file is modified.

**Experience Script (§3a):** *(the literal walkthrough the Experience Runner replays at build time and again at Verify — the reporter's manual click-through is the same scenario)*

```
# Experience Script — issue #15: collapsible structured container log viewer

Environment: local dev dashboard running (npm run dev in repo root → http://localhost:3000).
Precondition: at least one run exists that reached the build stage and produced
container logs at data/runs/[runId]/containers/*.log. If none exists, run the
build loop once on a trivial story to generate one.

Steps:
1. Open http://localhost:3000 in a browser.
2. Navigate to the Runs list. Click the run that reached the build stage.
3. On the run detail page, find the ContainerGrid. Click a container tile
   that has a log file (the ContainerLogViewer appears below or in a panel).
4. ASSERT: the ContainerLogViewer does NOT show a raw <pre> block of JSONL.
   Instead it shows a toolbar (tail/full toggle, type-filter dropdown,
   expand-all / collapse-all) and a list of structured rows.
5. ASSERT: each row header shows a type Badge (step_start / step_finish /
   tool_use / text), and tool_use rows show the tool name (read/bash/edit/...)
   with a wrench icon. step_finish rows show a token count and a dollar cost.
   A timestamp is right-aligned on each header.
6. ASSERT: all rows are collapsed by default (bodies hidden; chevrons point right).
7. Click a tool_use row header.
8. ASSERT: the row expands (chevron rotates to down). The body shows "Input"
   with the tool's input as formatted JSON, and "Output" with the tool's output
   string in a scrollable area.
9. Click the same header again. ASSERT: the row collapses (body hidden).
10. In the type-filter dropdown, select "tool_use".
11. ASSERT: the list now shows only tool_use rows.
12. Reset the filter to "all".
13. Click "Expand all".
14. ASSERT: every visible row is expanded (all bodies visible, all chevrons down).
15. Click "Collapse all".
16. ASSERT: every row is collapsed.
17. Wait for a poll tick (if tail mode is on) or toggle full mode. ASSERT: the
    viewer still renders structured rows; no raw JSONL appears; no error is
    thrown if a line is malformed (it renders as an amber "raw" row).

PASS criteria: steps 4-17 all ASSERT true. The viewer never shows unparsed
JSONL, never throws on a malformed line, and preserves the tail/full/polling
behavior that existed before.
```

---

## 10. Test & Verification Plan

- **Automated (unit):** `src/dashboard/lib/parseContainerLogs.test.ts` —
  - `parses a well-formed JSONL sample` covering all four kinds (step_start, step_finish, tool_use, text) with representative payloads; asserts each field populates correctly.
  - `handles malformed lines as kind:raw without throwing` — feed a mix of valid JSONL and garbage lines (`not json`, `{`, partial JSON); assert each bad line becomes a `raw` entry with `content` = the original line, and parsing completes.
  - `deduplicates identical entries by (kind, timestamp, callID|messageID) regardless of position (consecutive or interleaved)` — feed a sample containing both patterns: consecutive duplicates (`[step_start, step_start]`) and interleaved duplicates (`[tool_use_A, step_finish_A, tool_use_A, step_finish_A]` where 1≡3 and 2≡4); assert both patterns collapse, the output contains each unique tuple once, and the survivors are in first-occurrence order.
  - `returns [] for empty input`.
  - `preserves the original line in ParsedLogEntry.raw for every kind`.
- **Automated (component, if a test harness exists for the dashboard):** render `ContainerLogViewer` with a fixture `text`, assert collapsed-by-default, assert click expands, assert filter narrows, assert expand-all/collapse-all. If no dashboard component-test harness is set up, log to PARKING_LOT.md and rely on the Experience Script for UI verification.
- **Experience:** the §9 Experience Script — the Experience Runner drives the running dashboard through steps 1-17 and must return PASS before the story clears the build loop.
- **Regression:** the parser unit tests protect the §8 blast radius for the parsing path (malformed input is the chief regression risk). The `LiveTraceStream` is not modified, so it needs no new test — its existing behavior is the regression baseline.
- **Manual:** the reporter (Royce) confirms by reviewing the passing Experience Runner report, and optionally re-drives steps 1-17 themselves. Autonomous mode may waive Royce's own re-click per the proxy's human-only rules, but never waives the Experience Runner pass.

---

## 11. Rollback Plan

Filled before execution so reverting never requires archaeology:

- **Branch:** `issue/15-collapsible-container-logs` — all commits reference `#15`.
- **Merge:** single squash-merge commit per PR; SHA recorded in the issue's Tracking table on GitHub.
- **Revert:** `git revert -m 1 <merge-sha>` (squash merge → `git revert <squash-sha>`). The revert restores the original `<pre>{text}</pre>` render and deletes `parseContainerLogs.ts` + its test. No other file is touched, so the revert is clean and isolated.
- **Migrations:** none — no schema, no API, no env var, no build-loop change. Nothing to run before reverting.
- **Deploy rollback:** per `anymake-deploy` — the previous dashboard release identifier (the build prior to this PR's merge). Since the dashboard is a static/client-rendered surface with no server migration, rollback is a redeploy of the prior build artifact; no data implication.

---

## 12. Review Log

Appended each round — never deleted. Review files live beside this plan.

| Round | Date | Reviewer verdict | Report | Resolution |
|-------|------|------------------|--------|------------|
| 1 | 2026-08-13 | NEEDS CHANGES | `review-round-1.md` — 1-C1 (wrong discriminator: `part.type` hyphenated vs `LogKind` underscored), 1-C2 (consecutive-only dedup misses interleaved duplicates) | Both fixed: 1-C1 fixed in §4.1 (dispatch on top-level `type`, not `part.type`); 1-C2 fixed in §4.1 (seen-set dedup) and §10 (test rewritten to assert dedup of consecutive AND interleaved duplicates). |

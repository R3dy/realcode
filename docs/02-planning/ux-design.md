# UX Design — realcode dashboard

> As-built design record for the realcode dashboard UI. Additive Component
> Inventory maintained alongside implementation (A4.5 onwards). The token
> palette lives in `src/dashboard/tailwind.config.js` (`ink-*` / `status-*` /
> `brand-*` — no `slate-*`).

## Component Inventory

| Component | File | Purpose | Primitives |
|-----------|------|---------|------------|
| `AppShell` | `components/AppShell.tsx` | Top-level layout (board / detail / settings) | — |
| `NewRunDialog` | `components/NewRunDialog.tsx` | Modal for creating a new run | `Button`, `Card` |
| `RunCard` | `components/RunCard.tsx` | Board run card | `Card`, `Badge`, `StatusDot` |
| `RunControls` | `components/RunControls.tsx` | Board controls (run-mode, concurrency) | `Button`, `Badge` |
| `StageStepper` | `components/StageStepper.tsx` | Per-stage horizontal stepper on the detail page | `StatusDot` |
| `StatStrip` | `components/StatStrip.tsx` | Board KPI strip | — |
| `TraceTimeline` | `components/TraceTimeline.tsx` | Stage + turn timeline (mock-data visual pattern) | `Badge`, `StatusDot` |
| `StoryProgress` | `components/StoryProgress.tsx` | Per-story progress list for the build stage (A4.5) — reads `/api/runs/[id]/build-state`, polls every 2s while the build stage is active. Each row: story ID (mono), title, status badge (`pending`/`building`/`validating`/`done`/`failed`/`escalated`), retry count, tokens, cost, duration. | `Card`, `Badge`, `StatusDot` |
| `ContainerGrid` | `components/ContainerGrid.tsx` | Per-container status grid for the build stage (A4.5) — reads `/api/runs/[id]/containers`, polls every 2s. Each card: container name (mono), story ID, role badge (worker/validator), status dot, duration. Clicking a card with a `log_path` selects it for the `ContainerLogViewer`. | `Card`, `Badge`, `StatusDot` |
| `LiveTraceStream` | `components/LiveTraceStream.tsx` | SSE-fed real-time timeline of agent messages + tool calls (A4.5) — consumes `/api/runs/[id]/trace` (SSE). Renders spans as they arrive: span name, role/agent, tool, tokens, cost, agent message. Reuses `TraceTimeline`'s visual pattern (ChevronRight, Wrench icon, mono font). Auto-scrolls; pauses on scroll-up; filter by stage/agent. | `Card`, `Badge`, `StatusDot` |
| `CurrentActivityBar` | `components/CurrentActivityBar.tsx` | Slim one-line "what's happening now" status bar for the run detail page (A11.3) — reads `live_state` from `GET /api/runs/[id]`, polls every 2s. Shows current stage name, status dot (run/pulse amber while running, green when completed, red when failed), one-line summary, elapsed time, and container id (first 12 chars). Renders above the stage cards when a `live_state` exists. | `Card`, `StatusDot` |
| `ContainerLogViewer` | `components/ContainerLogViewer.tsx` | Terminal-style raw stdout/stderr viewer (A4.5) — fetches `/api/runs/[id]/containers/[cid]/logs?tail=100`. `<pre>` on `bg-ink-950`, `font-mono`, auto-scroll with manual-scroll detection, "tail 100 / full" toggle. Like Docker Desktop's container logs pane. | `Card` |

## Design tokens (as-built)

| Token | Value | Use |
|-------|-------|-----|
| `ink-950` | `#0a0b12` | Log viewer terminal surface; near-black app background |
| `ink-900` | `#11131d` | Card surfaces |
| `ink-850` | `#161926` | Inset surfaces (story rows, container cards) |
| `ink-800` | `#1a1d2b` | Hover surfaces |
| `ink-700` / `ink-700/60` | `#272b3d` | Borders |
| `ink-600` | `#3a3f56` | Tertiary text |
| `ink-500` | `#6b7080` | Secondary text |
| `ink-300` | `#aab0cc` | Primary mono text |
| `ink-100` | `#e6e8f2` | Headings |
| `status-pass` | `#3fd68a` | Done / success badges |
| `status-run` | `#f0b440` | Building / running badges (amber `animate-pulseDot` on the dot) |
| `status-fail` | `#f06161` | Failed / escalated badges |
| `status-pause` | `#7c8cb0` | Paused / idle badges |
| `brand-500` / `brand-300` | `#7c5cff` / `#b3a2ff` | Worker role badge, accent |

**Rule:** never use raw `slate-*` classes — they resolve to Tailwind's default
slate (`#0f172a`), visibly different from `ink-*` (`#11131d`).

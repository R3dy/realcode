# realcode — Parking Lot

Out-of-scope ideas logged during build work. Each entry is a one-liner with the story that logged it and the reason it's parked.

---

## Subpath mounting for the opencode-config mount (post-MVP hardening)

**Logged by:** Story A4.3 (issue #4)
**Reason:** Mounting only `opencode.json` + `agent/` + `skills/` (excluding `node_modules/`, `plugins/`, and anything else in the config dir) would reduce the trust-boundary surface of the opencode-config mount. The MVP mounts the whole config dir read-only + runs a startup `scanForSecrets` guard (plan §4.6.1). Subpath mounting requires enumerating every needed file (fragile to config changes) and opencode's plugin resolution needs the full config dir structure. Revisit when the operator's config grows to include files that should NOT be reachable from sandboxed agents.

## Standalone /traces route

**Logged by:** Session 26 (dashboard mobile-first audit, 2026-08-14)
**Reason:** The AppShell NAV previously linked to `/traces` but no such route existed (404 on all devices). Removed the dead link during the mobile-first audit. Live, per-run tracing already lives on the run-detail page via `LiveTraceStream` (SSE stream of agent messages + tool calls). A standalone cross-run trace timeline view would be a new feature — re-add the NAV entry only when that view is built. Not a gap in shipped work; the trace capability is present, just not as a top-level page.

## Re-add the Planner role as an engine-orchestrated per-story container

**Logged by:** Issue #17 (ADR-012)
**Reason:** ADR-009 dropped the Planner role — workers get raw story text without a task brief. The engine could add a Planner container per story (mirroring Worker/Validator dispatch) if over-slicing recurs in the first 50 runs. Future: extend the container-per-subagent model to anymake-agile's Solution Architect / Plan Reviewer for the change flow.

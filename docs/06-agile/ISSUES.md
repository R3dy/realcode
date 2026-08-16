# realcode — Agile Issue Ledger

Local mirror of the GitHub issue index for the realcode product repo
(https://github.com/R3dy/realcode/issues).

| # | Title | Type | Severity | Status | Opened | Closed |
|---|-------|------|----------|--------|--------|--------|
| 1 | Dashboard: run detail route /runs/[id] is unbuilt (clicking any run crashes); stale failed runs cannot be cleared | bug | major | closed | 2026-08-11 | 2026-08-11 |
| 3 | Plan stage times out (5min) — agent spec references files not in sandbox, causing 139K token over-exploration | bug | major | closed | 2026-08-11 | 2026-08-11 |
| 4 | Build stage must orchestrate a multi-container anymake build loop, not collapse into a single sandbox | feature | — | intake | 2026-08-11 | — |

## Issue #17 — Design drift: realcode reimplements anymake instead of wrapping it
- **GitHub:** https://github.com/R3dy/realcode/issues/17
- **Labels:** type:design-drift, severity:critical, status:intake
- **Opened:** 2026-08-14
- **Summary:** PROJECT.md says realcode wraps anymake as a runtime dependency. In reality, anymake is not installed, agent specs inline frozen copies of anymake's methodology, the build loop is a 729-line reimplementation, the Planner role was dropped, and ADR-006/INV-7 actively forbid the agents from reading anymake docs. The project's unique selling point is false as built.
- **Status:** intake → planning (Cartographer + Solution Architect dispatched)

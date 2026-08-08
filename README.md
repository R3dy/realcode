# realcode

Autonomous idea-to-shipped harness that wraps the [anymake](https://github.com/R3dy/Anymake) build system.

## What it does

You run one command:

```
realcode run "build me a markdown-to-PDF CLI with watch mode"
```

The idea enters the pipeline as a **run** and flows through 6 stages, each delegating to the corresponding anymake phase:

1. **Frame** (anymake Phase 0) -- idea becomes a scoped project identity
2. **Discover** (anymake Phase 1) -- prior-art + risk pass
3. **Plan** (anymake Phase 2) -- PRD + architecture + design system
4. **Spec** (anymake Phase 3) -- ordered backlog with acceptance criteria
5. **Build** (anymake Phase 4) -- the inner Orchestrator -> Planner -> Worker -> Validator loop
6. **Ship** (anymake Phase 5) -- deploy + metrics

Every stage's output is schema-validated. Every agent action is traced. A hard $8 cost cap per run makes runaway spend impossible.

## Architecture

realcode is an **agentic harness** that wraps anymake -- it does not reimplement anymake's methodology. anymake provides the phases + agents + templates (the *what* and the *who*); realcode provides the autonomous harness runtime (the *how it runs unattended and observable*): the declarative stage-graph engine, Queue/Storage backend, Docker sandbox runner, OpenTelemetry tracing, control plane, dashboard, and cost cap.

See `docs/02-planning/` for the full design (pipeline-design.md, ADR-001..009, ux-design.md).

## Status

Phase 4 (Implementation) in progress. The headless-anymake spike (ADR-001) passed -- Option B (headless opencode-in-sandbox) confirmed. Repo scaffolded. Next: the build loop executes the backlog (M2 contracts -> M3 backend -> M4 engine -> ... -> M12 deploy).

## Tech stack

- TypeScript / Node.js (engine + CLI)
- Zod (canonical schemas)
- SQLite (dev backend)
- Docker (sandbox isolation)
- OpenTelemetry (tracing)
- Next.js 14 (dashboard)
- anymake (runtime dependency)

## License

MIT

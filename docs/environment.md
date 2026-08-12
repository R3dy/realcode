# realcode — Environment Doc

**For:** Experience Runner — how to launch the app and verify stories

## Launch Commands

### Engine + Dashboard (Docker Compose)

```bash
cd /home/royce/mission-control/PROJECTS/realcode/repo
docker compose up -d
```

- Dashboard: http://localhost:3001
- Phoenix traces: http://localhost:6006
- Engine: realcode-engine container (long-running dispatch loop)

### Tests

```bash
cd /home/royce/mission-control/PROJECTS/realcode/repo
npm test                    # vitest run (unit + integration)
npm run typecheck           # tsc --noEmit
npm run lint                # eslint src/
```

### Dashboard dev mode (for UI stories)

```bash
cd /home/royce/mission-control/PROJECTS/realcode/repo
npm run dashboard:dev       # next dev --dir src/dashboard (port 3000)
```

## Ready Signal

- Dashboard: HTTP 200 on `GET http://localhost:3001/api/runs`
- Engine: `docker logs realcode-engine` shows "graph: /app/stage-graph.yaml (6 stages)"
- Tests: `npm test` exits 0

## Base URL

- Dashboard: http://localhost:3001
- API: http://localhost:3001/api/

## Entry Points

- Runs board: `GET /` — lists all runs
- Run detail: `GET /runs/[id]` — per-run view with stage status + artifacts
- New run: `POST /api/runs` with body `{"idea": "...", "project_target": "..."}`
- Run detail API: `GET /api/runs/[id]`
- Delete run: `DELETE /api/runs/[id]`

## Test Accounts

N/A — realcode has no auth (thin dashboard, INV-5).

## Notes

- The dashboard reads from `data/runs/` (real run.json + stage artifacts)
- Phoenix traces are at localhost:6006 (OTLP/proto exporter)
- The sandbox image is `realcode-sandbox:latest` on `realcode-sandbox-net`
- The engine container spawns sandbox containers via Docker-in-Docker (docker.sock mounted)

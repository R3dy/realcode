"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  Trash2,
  Loader2,
  AlertTriangle,
  Terminal,
  X,
  Coins,
  Code2,
} from "lucide-react";
import { Button, Badge, Card, Skeleton, cn, RUN_STATUS_META } from "@/components/ui";
import { StageStepper } from "@/components/StageStepper";
import { StoryProgress } from "@/components/StoryProgress";
import { ContainerGrid } from "@/components/ContainerGrid";
import { ContainerLogViewer } from "@/components/ContainerLogViewer";
import { LiveTraceStream } from "@/components/LiveTraceStream";
import { CurrentActivityBar } from "@/components/CurrentActivityBar";
import {
  fetchRunDetail,
  deleteRun,
  mapRunRecord,
  type RunRecord,
} from "@/lib/api";
import { STAGE_ORDER, type StageName, type StageStatus } from "@/lib/data";
import type { DetailStageStatus, RunDetailResponse, LiveState } from "@/lib/engine";

const STAGE_DISPLAY: Record<StageName, string> = {
  conductor: "Conductor",
  frame: "Frame",
  discover: "Discover",
  plan: "Plan",
  spec: "Spec",
  build: "Build",
  ship: "Ship",
  change: "Change",
};

const DETAIL_STATUS_TONE: Record<DetailStageStatus, "pass" | "run" | "fail" | "pause" | "neutral"> = {
  pass: "pass",
  running: "run",
  fail: "fail",
  pause: "pause",
  pending: "neutral",
  "not-reached": "neutral",
};

const ACTIVE_STATUSES = new Set([
  "intake",
  "framed",
  "discovered",
  "planned",
  "specified",
  "built",
  "running",
  "claimed",
]);

export default function RunDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showRawBuild, setShowRawBuild] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{
    container_id: string;
    name: string;
    role: string;
    story_id: string;
  } | null>(null);

  const load = useCallback(async () => {
    const detail = await fetchRunDetail(params.id);
    if (detail === null) {
      setNotFound(true);
    } else {
      setData(detail);
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const isActive = data ? ACTIVE_STATUSES.has(data.run.status) : false;
      // Force-delete active runs (the user has been warned in the modal —
      // including the build-loop warning when containers are still running).
      // The route's 409 gates (active + build-loop) only fire for programmatic
      // non-force callers.
      const res = await deleteRun(params.id, isActive);
      if ("deleted" in res) {
        router.push("/");
      } else {
        setDeleteError(res.error || "Failed to delete run");
        setDeleting(false);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (notFound) {
    return <NotFoundState runId={params.id} />;
  }

  if (!data) return null;

  const { run, stages, artifacts } = data;
  const mapped = mapRunRecord(run as RunRecord);
  const meta = RUN_STATUS_META[mapped.status];
  const isActive = ACTIVE_STATUSES.has(run.status);
  const costPct = run.cap_usd > 0 ? Math.min(100, (run.spent_usd / run.cap_usd) * 100) : 0;
  const overCap = run.spent_usd >= run.cap_usd;

  // Build Stage Detail section: shown when the build stage is active or has
  // produced an artifact (or build-state.json exists). The new components are
  // ADDITIVE — they replace nothing; the existing per-stage build card stays
  // but gains a "View raw artifact" toggle when build_state is present.
  const buildState = (data as RunDetailResponse & { build_state?: unknown }).build_state;
  const buildStageActive = stages.build === "running";
  const showBuildDetail = buildStageActive || Boolean(artifacts.build) || Boolean(buildState);

  // Pipeline Activity section predicate (A11.3 — 1-C4): renders whenever a
  // live_state exists — including terminal runs. NOT gated on isActive.
  const liveState = (data as RunDetailResponse & { live_state?: LiveState }).live_state ?? null;
  const hasLiveActivity = Boolean(liveState);
  const hasRunningBuildContainers = Boolean(
    buildState &&
      typeof buildState === "object" &&
      Array.isArray((buildState as { stories?: Array<{ status?: string }> }).stories) &&
      (buildState as { stories: Array<{ status?: string }> }).stories.some(
        (s) => s.status === "building" || s.status === "validating",
      ),
  );

  // Build stages array for StageStepper
  const stepperStages = STAGE_ORDER.map((name) => ({
    name,
    status: (stages[name] === "not-reached" ? "pending" : stages[name]) as StageStatus,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <Link href="/">
                <Button variant="ghost" className="h-8 px-2">
                  <ChevronLeft className="h-4 w-4" />
                  Runs
                </Button>
              </Link>
              <span className="font-mono text-xs text-ink-500">{run.run_id}</span>
              <Badge tone={meta.tone} icon={meta.icon}>
                {meta.label}
              </Badge>
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-ink-100">
              {run.idea}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1">
                <Coins className="h-3.5 w-3.5" />
                <span className={cn(overCap && "text-status-fail font-medium")}>
                  ${run.spent_usd.toFixed(2)}
                </span>
                <span className="text-ink-600"> / ${run.cap_usd.toFixed(2)}</span>
              </span>
              <span className="font-mono">
                {new Date(run.created_at).toISOString().replace("T", " ").slice(0, 19)} UTC
              </span>
            </div>
            {/* Cost meter */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800" title={`$${run.spent_usd.toFixed(2)} / $${run.cap_usd.toFixed(2)}`}>
              <div
                className={cn("h-full rounded-full transition-all", overCap ? "bg-status-fail" : "bg-brand-500")}
                style={{ width: `${costPct}%` }}
              />
            </div>
            <div className="pt-1">
              <StageStepper stages={stepperStages} current={mapped.current} />
            </div>
          </div>
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            className="shrink-0"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Delete run</span>
          </Button>
        </div>
      </Card>

      {/* Pipeline Activity section (A11.3 — ungate realtime visibility for
        non-build stages). Renders whenever a live_state exists. CurrentActivityBar
        + live containers + trace stream + container logs for ANY active stage. */}
      {hasLiveActivity && (
        <div className="space-y-3">
          <CurrentActivityBar runId={params.id} liveState={liveState} runStatus={run.status} />
          <ContainerGrid
            runId={params.id}
            buildActive={buildStageActive}
            selectedCid={selectedContainer?.container_id ?? null}
            onSelect={(c) =>
              setSelectedContainer({
                container_id: c.container_id,
                name: c.name,
                role: c.role,
                story_id: c.story_id,
              })
            }
          />
          <LiveTraceStream runId={params.id} runActive={isActive} />
          <ContainerLogViewer
            runId={params.id}
            container={selectedContainer}
            runActive={isActive}
          />
        </div>
      )}

      {/* Stage cards */}
      <div className="space-y-3">
        {STAGE_ORDER.map((stageName) => {
          const status = stages[stageName];
          const artifact = artifacts[stageName];
          const tone = DETAIL_STATUS_TONE[status];
          const isBuildStage = stageName === "build";
          const collapseArtifact = isBuildStage && showBuildDetail && !showRawBuild;
          return (
            <Card key={stageName} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-ink-100">
                    {STAGE_DISPLAY[stageName]}
                  </span>
                  <Badge tone={tone}>
                    {status === "not-reached" ? "not reached" : status}
                  </Badge>
                  {isBuildStage && showBuildDetail && (
                    <button
                      type="button"
                      onClick={() => setShowRawBuild((v) => !v)}
                      className="ml-2 inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-ink-300 transition-colors hover:bg-ink-700"
                    >
                      <Code2 className="h-3 w-3" />
                      {showRawBuild ? "hide raw" : "view raw artifact"}
                    </button>
                  )}
                </div>
              </div>
              {collapseArtifact ? (
                <p className="text-xs text-ink-600">
                  Build stage detail shown below. Toggle “view raw artifact” to inspect the raw JSON.
                </p>
              ) : artifact ? (
                <pre className="max-h-[400px] overflow-auto rounded-lg border border-ink-700/40 bg-[#0a0b12] p-3 font-mono text-xs text-ink-300">
                  {JSON.stringify(artifact, null, 2)}
                </pre>
              ) : status === "not-reached" ? (
                <p className="text-xs text-ink-600">Not reached.</p>
              ) : status === "fail" ? (
                <p className="text-xs text-ink-600">Failed — no artifact written.</p>
              ) : (
                <p className="text-xs text-ink-600">No artifact available.</p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Build Stage Detail section (A4.5 — mission-control visibility) */}
      {showBuildDetail && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <StoryProgress runId={params.id} buildActive={buildStageActive} />
            <ContainerGrid
              runId={params.id}
              buildActive={buildStageActive}
              selectedCid={selectedContainer?.container_id ?? null}
              onSelect={(c) =>
                setSelectedContainer({
                  container_id: c.container_id,
                  name: c.name,
                  role: c.role,
                  story_id: c.story_id,
                })
              }
            />
          </div>
          <LiveTraceStream runId={params.id} runActive={buildStageActive} />
          <ContainerLogViewer
            runId={params.id}
            container={selectedContainer}
            runActive={buildStageActive}
          />
        </div>
      )}

      {/* Delete confirmation modal (inline-replicating NewRunDialog pattern) */}
      <AnimatePresence>
        {deleteOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => !deleting && setDeleteOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Delete run"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="relative w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-status-fail/15 text-status-fail">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <h2 className="font-display text-base font-semibold text-ink-100">
                    Delete run
                  </h2>
                </div>
                <button
                  onClick={() => !deleting && setDeleteOpen(false)}
                  className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4 px-5 py-5">
                <p className="text-sm text-ink-300">
                  Delete run{" "}
                  <code className="rounded bg-ink-850 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                    {run.run_id}
                  </code>
                  ? This removes its data directory, workspace, and any queued work
                  items. This cannot be undone.
                </p>
                {isActive && (
                  <div className="rounded-lg border border-status-run/30 bg-status-run/5 px-3 py-2 text-xs text-status-run">
                    ⚠ This run is still active. Deleting it will not stop the engine
                    from processing it. Consider pausing first.
                  </div>
                )}
                {hasRunningBuildContainers && (
                  <div className="rounded-lg border border-status-fail/30 bg-status-fail/5 px-3 py-2 text-xs text-status-fail">
                    ⚠ Build loop has running containers. Deleting mid-loop orphans
                    them against a removed workspace. Use force-delete to tear them
                    down first.
                  </div>
                )}
                {deleteError && (
                  <div className="rounded-lg border border-status-fail/30 bg-status-fail/5 px-3 py-2 text-xs text-status-fail">
                    {deleteError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => !deleting && setDeleteOpen(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" />
                        Confirm delete
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotFoundState({ runId }: { runId: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-ink-800 text-ink-500">
          <Terminal className="h-6 w-6" />
        </div>
        <h3 className="font-display text-lg font-semibold text-ink-100">
          Run <code className="font-mono text-brand-300">{runId}</code> doesn&apos;t exist.
        </h3>
        <p className="mt-1 text-sm text-ink-500">
          It may have been deleted, or the id was entered incorrectly.
        </p>
        <Link href="/" className="mt-4">
          <Button variant="secondary">
            <ChevronLeft className="h-4 w-4" />
            Back to runs
          </Button>
        </Link>
      </Card>
    </div>
  );
}

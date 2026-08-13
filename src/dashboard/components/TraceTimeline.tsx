"use client";
import { motion } from "framer-motion";
import { ChevronRight, Wrench, Cpu, Coins, Clock, CircleSlash } from "lucide-react";
import { Badge, STAGE_STATUS_TONE, StatusDot, cn } from "@/components/ui";
import { fmtCost, fmtLatency, fmtTokens, type Run, type Turn } from "@/lib/data";

export function TraceTimeline({ run }: { run: Run }) {
  const stages = run.stages.filter((s) => s.status !== "pending");
  return (
    <div className="space-y-2.5">
      {stages.map((s, si) => {
        const tone = STAGE_STATUS_TONE[s.status];
        return (
          <motion.div
            key={s.name}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: si * 0.05, ease: "easeOut" }}
            className="overflow-hidden rounded-lg border border-ink-700/60 bg-ink-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-l-2 px-4 py-3" style={{ borderColor: borderColor(s.status) }}>
              <div className="flex items-center gap-2.5">
                <StatusDot tone={tone} pulse={s.status === "running"} />
                <span className="font-mono text-sm font-semibold text-ink-100">{s.name}</span>
                <span className="text-xs text-ink-600">stage</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1"><Coins className="h-3.5 w-3.5" />{fmtCost(s.costUsd)}</span>
                <span className="inline-flex items-center gap-1"><Cpu className="h-3.5 w-3.5" />{fmtTokens(s.tokens)}</span>
                {s.status !== "running" && s.latencyMs > 0 && (
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{fmtLatency(s.latencyMs)}</span>
                )}
                <Badge tone={tone}>{s.status}</Badge>
              </div>
            </div>
            {s.turns && s.turns.length > 0 && (
              <div className="border-t border-ink-800/80 bg-ink-950/40">
                {s.turns.map((t, ti) => (
                  <TurnRow key={ti} turn={t} isLast={ti === s.turns!.length - 1} />
                ))}
              </div>
            )}
          </motion.div>
        );
      })}
      {run.status === "paused_cost_cap" && (
        <div className="flex items-center gap-2 rounded-lg border border-status-fail/40 bg-status-fail/5 px-4 py-3 text-status-fail">
          <CircleSlash className="h-4 w-4" />
          <span className="text-sm font-medium">Cost cap hit at {fmtCost(run.costUsd)} mid-build.</span>
          <span className="text-xs text-status-fail/70">{run.escalationReason}</span>
        </div>
      )}
      {run.status === "escalated" && run.escalationReason && (
        <div className="flex items-center gap-2 rounded-lg border border-status-fail/40 bg-status-fail/5 px-4 py-3 text-status-fail">
          <CircleSlash className="h-4 w-4" />
          <span className="text-sm font-medium">Escalated: {run.escalationReason}</span>
        </div>
      )}
    </div>
  );
}

function TurnRow({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  const fail = turn.note.startsWith("Validation FAIL");
  return (
    <div className={cn("px-4 py-2.5", !isLast && "border-b border-ink-800/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ChevronRight className="h-3.5 w-3.5 text-ink-600" />
        <span className={cn("font-mono text-xs", fail ? "text-status-fail" : "text-ink-300")}>{turn.agent}</span>
        <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">{turn.model}</span>
        <span className="ml-auto inline-flex items-center gap-3 text-[11px] text-ink-500">
          <span className="inline-flex items-center gap-1"><Coins className="h-3 w-3" />{fmtCost(turn.costUsd)}</span>
          <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" />{fmtTokens(turn.tokens)}</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtLatency(turn.latencyMs)}</span>
        </span>
      </div>
      <p className={cn("mt-1 pl-5 text-xs", fail ? "text-status-fail/90" : "text-ink-500")}>{turn.note}</p>
      {turn.tools.length > 0 && (
        <div className="mt-1.5 ml-5 flex flex-wrap gap-1.5">
          {turn.tools.map((tool, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
              <Wrench className="h-2.5 w-2.5 text-ink-600" />
              <span className="text-brand-300">{tool.name}</span>
              <span className="text-ink-600">(</span>
              <span className="text-ink-500">{tool.args}</span>
              <span className="text-ink-600">)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function borderColor(status: string): string {
  return status === "pass" ? "#3fd68a" : status === "running" ? "#f0b440" : status === "fail" ? "#f06161" : status === "pause" ? "#7c8cb0" : "#272b3d";
}

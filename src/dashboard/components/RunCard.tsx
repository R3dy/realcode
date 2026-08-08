"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Coins, Zap, Clock } from "lucide-react";
import { Badge, Card, RUN_STATUS_META, cn } from "@/components/ui";
import { StageStepper } from "@/components/StageStepper";
import { fmtCost, fmtLatency, fmtTokens, type Run } from "@/lib/data";

export function RunCard({ run, index }: { run: Run; index: number }) {
  const meta = RUN_STATUS_META[run.status];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04, ease: "easeOut" }}
    >
      <Link href={`/runs/${run.id}`} className="group block">
        <Card className="p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-500/40 hover:bg-ink-850">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-xs text-ink-500">{run.id}</span>
                <Badge tone={meta.tone} icon={meta.icon}>
                  {meta.label}
                </Badge>
              </div>
              <p className="truncate text-sm font-medium text-ink-100">{run.idea}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-500 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-300" />
          </div>

          <div className="mt-3">
            <StageStepper stages={run.stages} current={run.current} compact />
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3.5 w-3.5" />
              <span className={cn(run.status === "paused_cost_cap" && "text-status-fail font-medium")}>
                {fmtCost(run.costUsd)}
                <span className="text-ink-600"> / {fmtCost(run.capUsd)}</span>
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              {fmtTokens(run.stages.reduce((a, s) => a + s.tokens, 0))} tok
            </span>
            {run.status !== "running" && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {fmtLatency(run.latencyMs)}
              </span>
            )}
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

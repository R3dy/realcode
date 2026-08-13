"use client";
import { cn } from "@/components/ui";
import { STAGE_ORDER, type StageName, type StageStatus } from "@/lib/data";
import { Check, X } from "lucide-react";

export function StageStepper({
  stages,
  current,
  compact,
}: {
  stages: { name: StageName; status: StageStatus }[];
  current?: StageName;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        compact ? "gap-1" : "gap-1.5",
      )}
    >
      {STAGE_ORDER.map((name, i) => {
        const s = stages.find((x) => x.name === name);
        const status = s?.status ?? "pending";
        const isCurrent = name === current;
        return (
          <div key={name} className="flex shrink-0 items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex items-center justify-center rounded-md border text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  compact ? "h-5 px-1.5" : "h-6 px-2",
                  status === "pass" && "border-status-pass/40 bg-status-pass/10 text-status-pass",
                  status === "running" && "border-status-run/50 bg-status-run/10 text-status-run",
                  status === "fail" && "border-status-fail/50 bg-status-fail/10 text-status-fail",
                  status === "pause" && "border-status-pause/50 bg-status-pause/10 text-status-pause",
                  status === "pending" && "border-ink-700 bg-ink-850 text-ink-500",
                )}
              >
                {status === "pass" ? (
                  <Check className="h-3 w-3" />
                ) : status === "fail" ? (
                  <X className="h-3 w-3" />
                ) : status === "running" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-status-run animate-pulseDot" />
                ) : (
                  ""
                )}
                <span className="font-mono">{name}</span>
              </span>
              {status === "running" && isCurrent && (
                <span className="hidden sm:inline text-[10px] text-status-run/80 font-mono">live</span>
              )}
            </div>
            {i < STAGE_ORDER.length - 1 && (
              <div
                className={cn(
                  "mx-0.5 h-px",
                  status === "pass" ? "bg-status-pass/40" : "bg-ink-700",
                  compact ? "w-3" : "w-4",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

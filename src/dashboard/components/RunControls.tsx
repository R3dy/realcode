"use client";
import { useState } from "react";
import { Play, Pause, StepForward, AlertOctagon } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { STAGE_ORDER } from "@/lib/data";

export function RunControls({
  mode,
  onMode,
}: {
  mode: "continuous" | "step" | "paused";
  onMode: (m: "continuous" | "step" | "paused") => void;
}) {
  const [concurrency, setConcurrency] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, string>>({ build: "anthropic/claude-haiku-4-5" });

  const modes = [
    { id: "continuous" as const, label: "Continuous", icon: Play, desc: "advance without stopping" },
    { id: "step" as const, label: "Step", icon: StepForward, desc: "one stage, then re-pause" },
    { id: "paused" as const, label: "Paused", icon: Pause, desc: "hold all dispatch" },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Run mode</h3>
        <div className="grid grid-cols-3 gap-2">
          {modes.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onMode(m.id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors",
                  active
                    ? m.id === "continuous"
                      ? "border-brand-500/50 bg-brand-500/10 text-brand-300"
                      : m.id === "step"
                        ? "border-status-run/50 bg-status-run/10 text-status-run"
                        : "border-status-pause/50 bg-status-pause/10 text-status-pause"
                    : "border-ink-700 bg-ink-850 text-ink-500 hover:bg-ink-800",
                )}
              >
                <m.icon className="h-4 w-4" />
                <span className="text-xs font-medium">{m.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-ink-600">{modes.find((m) => m.id === mode)?.desc}</p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Concurrency</h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={4}
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-ink-700 accent-brand-500"
          />
          <span className="w-8 text-center font-mono text-sm text-ink-100">{concurrency}</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-600">worker pool size · MVP default 1</p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Per-stage model overrides</h3>
        <div className="space-y-1.5">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span className="w-12 font-mono text-xs text-ink-500">{s}</span>
              <select
                value={overrides[s] ?? "tier"}
                onChange={(e) => setOverrides((o) => ({ ...o, [s]: e.target.value }))}
                className="flex-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 font-mono text-xs text-ink-100 focus:border-brand-500 focus:outline-none"
              >
                <option value="tier">tier default</option>
                <option value="anthropic/claude-opus-5">opus-5 · t1</option>
                <option value="anthropic/claude-sonnet-5">sonnet-5 · t2</option>
                <option value="anthropic/claude-haiku-4-5">haiku-4.5 · t3</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Cost cap</h3>
        <div className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5">
          <span className="text-xs text-ink-500">per run, hard trip</span>
          <span className="font-mono text-sm text-status-fail">$8.00</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-600">non-overridable · breaker writes paused_cost_cap</p>
      </section>

      <Button variant="destructive" className="w-full">
        <AlertOctagon className="h-4 w-4" /> Pause all runs
      </Button>
    </div>
  );
}

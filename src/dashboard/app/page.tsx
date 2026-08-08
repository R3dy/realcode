"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Search } from "lucide-react";
import { StatStrip } from "@/components/StatStrip";
import { RunCard } from "@/components/RunCard";
import { runs as ALL_RUNS, type RunStatus } from "@/lib/data";
import { cn } from "@/components/ui";

type Filter = "all" | "running" | "paused" | "escalated" | "shipped";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "paused", label: "Paused" },
  { id: "escalated", label: "Escalated" },
  { id: "shipped", label: "Shipped" },
];

const GROUPS: { id: Filter; label: string; match: (s: RunStatus) => boolean }[] = [
  { id: "running", label: "Running", match: (s) => s === "running" },
  { id: "paused", label: "Paused · step / cost cap", match: (s) => s === "paused_step" || s === "paused_cost_cap" },
  { id: "escalated", label: "Escalated", match: (s) => s === "escalated" || s === "failed" },
  { id: "shipped", label: "Shipped", match: (s) => s === "shipped" },
];

export default function BoardPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const filtered = ALL_RUNS.filter((r) => {
    if (q && !r.idea.toLowerCase().includes(q.toLowerCase()) && !r.id.includes(q)) return false;
    if (filter === "all") return true;
    return GROUPS.find((g) => g.id === filter)?.match(r.status);
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-100">Runs</h1>
        <p className="mt-0.5 text-sm text-ink-500">Every idea moving through the pipeline. Click a run to inspect its full trace.</p>
      </div>

      <StatStrip />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.id ? "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30" : "text-ink-500 hover:bg-ink-800 hover:text-ink-100",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-600" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search idea or run id..."
            className="h-8 w-56 rounded-lg border border-ink-700 bg-ink-850 pl-8 pr-3 text-xs text-ink-100 placeholder:text-ink-600 focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : filter === "all" ? (
        <div className="space-y-7">
          {GROUPS.map((g) => {
            const groupRuns = filtered.filter((r) => g.match(r.status));
            if (groupRuns.length === 0) return null;
            return (
              <section key={g.id}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{g.label}</h2>
                  <span className="text-xs text-ink-600">{groupRuns.length}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {groupRuns.map((r, i) => (
                    <RunCard key={r.id} run={r} index={i} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <motion.div layout className="grid gap-3 md:grid-cols-2">
          {filtered.map((r, i) => (
            <RunCard key={r.id} run={r} index={i} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-700 bg-ink-900/50 px-6 py-16 text-center"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-300">
        <Terminal className="h-6 w-6" />
      </div>
      <h3 className="font-display text-lg font-semibold text-ink-100">No runs match</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">
        Start a run from the command line or the <span className="text-ink-300">New run</span> button.
      </p>
      <code className="mt-4 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs text-brand-300">
        realcode run &quot;build me a markdown-to-PDF CLI&quot;
      </code>
    </motion.div>
  );
}

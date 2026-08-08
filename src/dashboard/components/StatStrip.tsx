"use client";
import { motion } from "framer-motion";
import { Activity, DollarSign, Package, Gauge, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { fmtCost, stats } from "@/lib/data";

function Stat({
  label,
  value,
  sub,
  icon,
  accent,
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      className={`relative overflow-hidden rounded-xl border p-4 ${
        accent
          ? "border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-ink-900"
          : "border-ink-700/60 bg-ink-900"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-500">{label}</span>
        <span className={accent ? "text-brand-300" : "text-ink-600"}>{icon}</span>
      </div>
      <div className={`mt-1.5 font-display font-bold tracking-tight ${accent ? "text-brand-300" : "text-ink-100"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </motion.div>
  );
}

export function StatStrip({ loading }: { loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Active runs"
        value={String(stats.activeRuns)}
        sub="dispatching now"
        icon={<Activity className="h-4 w-4" />}
        accent
        delay={0}
      />
      <Stat
        label="Today's spend"
        value={fmtCost(stats.todaySpend)}
        sub={`cap $8.00 / run`}
        icon={<DollarSign className="h-4 w-4" />}
        delay={0.05}
      />
      <Stat
        label="Shipped today"
        value={String(stats.shippedToday)}
        sub="zero human edits"
        icon={<Package className="h-4 w-4" />}
        delay={0.1}
      />
      <Stat
        label="Avg cost / run"
        value={fmtCost(stats.avgCostPerRun)}
        sub={stats.escalations ? `${stats.escalations} escalation${stats.escalations > 1 ? "s" : ""}` : "no escalations"}
        icon={<Gauge className="h-4 w-4" />}
        delay={0.15}
      />
    </div>
  );
}

export { StatStrip as default };

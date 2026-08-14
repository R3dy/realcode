"use client";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Settings, Plus, SlidersHorizontal, X } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { RunControls } from "@/components/RunControls";
import { NewRunDialog } from "@/components/NewRunDialog";
import { usePoll, type ControlDoc } from "@/lib/api";

// Traces intentionally omitted: no /traces route exists. Live tracing lives on
// the run-detail page (LiveTraceStream). Re-add when a standalone traces view ships.
const NAV = [
  { label: "Runs", icon: Activity, href: "/" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const { data } = usePoll<ControlDoc>("/api/control");
  const [mode, setMode] = useState<"continuous" | "step" | "paused">("continuous");

  useEffect(() => {
    if (data) {
      setMode(data.run_mode === "paused_cost_cap" ? "paused" : data.run_mode);
    }
  }, [data]);

  const modeTone =
    mode === "continuous" ? "text-brand-300 bg-brand-500/10 border-brand-500/30" : mode === "step" ? "text-status-run bg-status-run/10 border-status-run/30" : "text-status-pause bg-status-pause/10 border-status-pause/30";

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar nav (>= md). Mobile uses the bottom nav below. */}
      <aside className="sticky top-0 hidden h-screen w-16 flex-col items-center gap-1 border-r border-ink-800/80 bg-ink-950/60 py-4 md:flex">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient text-sm font-bold text-white shadow-glow">r</div>
        {NAV.map((n) => (
          <a
            key={n.label}
            href={n.href}
            title={n.label}
            className="group flex h-10 w-10 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100"
          >
            <n.icon className="h-5 w-5" />
          </a>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-ink-800/80 bg-ink-950/80 px-4 backdrop-blur-md md:gap-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-gradient text-xs font-bold text-white md:hidden">r</div>
            <span className="font-display text-base font-bold tracking-tight text-ink-100">realcode</span>
            <span className="hidden rounded-md border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 sm:inline">v0.1 dev</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setControlsOpen(true)}
              title={`Run mode: ${mode}`}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                modeTone,
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {/* Hide the mode word on the narrowest screens; the colored dot +
                  border still communicate state. */}
              <span className="font-mono hidden sm:inline">{mode}</span>
              <SlidersHorizontal className="h-3 w-3 opacity-60" />
            </button>
            <Button onClick={() => setNewOpen(true)} className="h-8 px-3" title="New run">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New run</span>
            </Button>
          </div>
        </header>

        {/* Bottom padding on main so content clears the mobile bottom nav. */}
        <main className="flex-1 px-4 py-5 pb-24 md:px-6 md:py-6 md:pb-6">{children}</main>
      </div>

      {/* Mobile bottom navigation (replaces the desktop sidebar on < md). */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-ink-800/80 bg-ink-950/90 backdrop-blur-md md:hidden">
        {NAV.filter((n) => n.href !== "/").map((n) => (
          <a
            key={n.label}
            href={n.href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-ink-500 transition-colors hover:text-ink-100"
          >
            <n.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{n.label}</span>
          </a>
        ))}
        <a href="/" className="flex flex-1 flex-col items-center justify-center gap-0.5 text-ink-500 transition-colors hover:text-ink-100">
          <Activity className="h-5 w-5" />
          <span className="text-[10px] font-medium">Runs</span>
        </a>
        <button
          onClick={() => setNewOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-brand-300 transition-colors hover:text-brand-200"
          aria-label="New run"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-glow">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-[10px] font-medium">New</span>
        </button>
      </nav>

      <Sheet open={controlsOpen} onClose={() => setControlsOpen(false)} title="Control plane" subtitle="takes effect next dispatch cycle">
        <RunControls mode={mode} onMode={setMode} />
      </Sheet>

      {/* Single canonical New Run flow — the NewRunDialog with project targeting,
          shared by the header, the board page, and the mobile bottom nav. */}
      <NewRunDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => {}} />
    </div>
  );
}

function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: 380 }}
            animate={{ x: 0 }}
            exit={{ x: 380 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[380px] flex-col border-l border-ink-700 bg-ink-900 shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-ink-800 p-5">
              <div>
                <h2 className="font-display text-lg font-bold text-ink-100">{title}</h2>
                <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export { NAV };

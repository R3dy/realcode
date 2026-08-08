"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ListTree, Settings, Plus, SlidersHorizontal, X, Terminal, Play, Pause, StepForward } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { RunControls } from "@/components/RunControls";

const NAV = [
  { label: "Runs", icon: Activity, href: "/" },
  { label: "Traces", icon: ListTree, href: "/runs/run_2k9f3a" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [mode, setMode] = useState<"continuous" | "step" | "paused">("continuous");

  const modeTone =
    mode === "continuous" ? "text-brand-300 bg-brand-500/10 border-brand-500/30" : mode === "step" ? "text-status-run bg-status-run/10 border-status-run/30" : "text-status-pause bg-status-pause/10 border-status-pause/30";

  return (
    <div className="flex min-h-screen">
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
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-800/80 bg-ink-950/80 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-gradient text-xs font-bold text-white md:hidden">r</div>
            <span className="font-display text-base font-bold tracking-tight text-ink-100">realcode</span>
            <span className="hidden rounded-md border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 sm:inline">v0.1 dev</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setControlsOpen(true)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                modeTone,
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              <span className="font-mono">{mode}</span>
              <SlidersHorizontal className="h-3 w-3 opacity-60" />
            </button>
            <Button onClick={() => setNewOpen(true)} className="h-8 px-3">
              <Plus className="h-4 w-4" /> New run
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>

      <Sheet open={controlsOpen} onClose={() => setControlsOpen(false)} title="Control plane" subtitle="takes effect next dispatch cycle">
        <RunControls mode={mode} onMode={setMode} />
      </Sheet>

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="Start a run" subtitle="a raw idea enters the pipeline at frame">
        <NewRunSheet />
      </Sheet>
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

function NewRunSheet() {
  const [idea, setIdea] = useState("");
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-ink-500">Idea</label>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={4}
          placeholder="Build a markdown-to-PDF CLI with watch mode"
          className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 transition-colors focus:border-brand-500 focus:outline-none"
        />
      </div>
      <div className="rounded-lg border border-ink-700 bg-ink-950 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-500">
          <Terminal className="h-3.5 w-3.5" /> equivalent CLI
        </div>
        <code className="block font-mono text-xs text-brand-300">
          realcode run &quot;{idea || "..."}&quot;
        </code>
      </div>
      <Button className="w-full" disabled={!idea}>
        <Play className="h-4 w-4" /> Start run
      </Button>
      <p className="text-center text-[11px] text-ink-600">
        Enters <span className="font-mono text-ink-500">frame</span>, then discover, plan, spec, build, ship. Cap $8.00.
      </p>
    </div>
  );
}

export { NAV };

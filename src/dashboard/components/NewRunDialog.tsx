"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Rocket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

const TARGET_OPTIONS = [
  { value: "", label: "New project (empty workspace)" },
  { value: "realvol", label: "realvol" },
  { value: "realhax", label: "realhax" },
  { value: "realcode", label: "realcode" },
  { value: "basecamp", label: "basecamp" },
  { value: "realmemory", label: "realmemory" },
] as const;

export function NewRunDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [idea, setIdea] = useState("");
  const [target, setTarget] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIdea("");
      setTarget("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = idea.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    const prefix = target ? `[target: ${target}] ` : "";
    const finalIdea = `${prefix}${trimmed}`;
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: finalIdea }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New run"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="relative w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
                  <Rocket className="h-4 w-4" />
                </div>
                <h2 className="font-display text-base font-semibold text-ink-100">New run</h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
              <div className="space-y-1.5">
                <label htmlFor="newrun-idea" className="text-xs font-medium text-ink-300">
                  Idea
                </label>
                <textarea
                  id="newrun-idea"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  autoFocus
                  rows={4}
                  placeholder="Describe what to build..."
                  className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="newrun-target" className="text-xs font-medium text-ink-300">
                  Target project <span className="text-ink-600">(optional)</span>
                </label>
                <select
                  id="newrun-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
                >
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {target && (
                  <p className="text-xs text-ink-600">
                    Hint prefix <code className="text-brand-300">[target: {target}]</code> will be prepended to the idea.
                  </p>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-status-fail/30 bg-status-fail/5 px-3 py-2 text-xs text-status-fail">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!idea.trim() || submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Launching...
                    </>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4" />
                      Launch
                    </>
                  )}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

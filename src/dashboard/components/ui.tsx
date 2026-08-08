import { clsx } from "clsx";
import React from "react";
import { CheckCircle2, Loader2, AlertTriangle, PauseCircle, Ban } from "lucide-react";
import type { RunStatus, StageStatus } from "@/lib/data";

export function cn(...c: (string | false | null | undefined)[]) {
  return clsx(...c);
}

export function Button({
  variant = "primary",
  className,
  children,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed px-3.5 h-9 whitespace-nowrap";
  const v = {
    primary: "bg-brand-gradient text-white shadow-glow hover:brightness-110 active:brightness-95",
    secondary: "bg-ink-800 text-ink-100 border border-ink-700 hover:bg-ink-700",
    ghost: "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
    destructive: "bg-status-fail/15 text-status-fail border border-status-fail/40 hover:bg-status-fail/25",
  }[variant];
  return (
    <button className={cn(base, v, className)} {...p}>
      {children}
    </button>
  );
}

type Tone = "pass" | "run" | "fail" | "pause" | "neutral" | "brand";

const TONES: Record<Tone, string> = {
  pass: "bg-status-pass/12 text-status-pass border-status-pass/30",
  run: "bg-status-run/12 text-status-run border-status-run/30",
  fail: "bg-status-fail/12 text-status-fail border-status-fail/30",
  pause: "bg-status-pause/12 text-status-pause border-status-pause/30",
  brand: "bg-brand-500/12 text-brand-300 border-brand-500/30",
  neutral: "bg-ink-800 text-ink-300 border-ink-700",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-ink-700/60 bg-ink-900", className)}>
      {children}
    </div>
  );
}

export function StatusDot({
  tone,
  pulse,
}: {
  tone: Tone;
  pulse?: boolean;
}) {
  const c = {
    pass: "bg-status-pass",
    run: "bg-status-run",
    fail: "bg-status-fail",
    pause: "bg-status-pause",
    brand: "bg-brand-500",
    neutral: "bg-ink-500",
  }[tone];
  return (
    <span className={cn("inline-block h-2 w-2 rounded-full", c, pulse && "animate-pulseDot")} />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md bg-ink-800", className)} />;
}

export const RUN_STATUS_META: Record<
  RunStatus,
  { label: string; tone: Tone; icon: React.ReactNode }
> = {
  running: { label: "Running", tone: "run", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  paused_step: { label: "Paused · step", tone: "pause", icon: <PauseCircle className="h-3 w-3" /> },
  escalated: { label: "Escalated", tone: "fail", icon: <AlertTriangle className="h-3 w-3" /> },
  paused_cost_cap: { label: "Cost cap hit", tone: "fail", icon: <Ban className="h-3 w-3" /> },
  shipped: { label: "Shipped", tone: "pass", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Failed", tone: "fail", icon: <AlertTriangle className="h-3 w-3" /> },
};

export const STAGE_STATUS_TONE: Record<StageStatus, Tone> = {
  pass: "pass",
  running: "run",
  fail: "fail",
  pause: "pause",
  pending: "neutral",
};

"use client";
import { Card } from "@/components/ui";
import { Package, Cpu, DollarSign } from "lucide-react";

export default function SettingsPage() {
  const rows = [
    { icon: Package, label: "anymake pin", value: "github:R3dy/Anymake@ff0ee645" },
    { icon: Cpu, label: "model tiers", value: "T1 opus-5 · T2 sonnet-5 · T3 haiku-4.5" },
    { icon: DollarSign, label: "cost cap / run", value: "$8.00 (hard trip)" },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-100">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">Harness configuration. Most of these are stage-graph config, not runtime toggles.</p>
      </div>
      <Card className="divide-y divide-ink-800">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col items-start gap-1 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-center gap-2.5">
              <r.icon className="h-4 w-4 text-ink-600" />
              <span className="text-sm text-ink-300">{r.label}</span>
            </div>
            <code className="break-all font-mono text-xs text-brand-300 sm:text-right">{r.value}</code>
          </div>
        ))}
      </Card>
      <p className="text-xs text-ink-600">Full settings (LLM provider keys, tracing collector URL, backend selection) land with the production build.</p>
    </div>
  );
}
